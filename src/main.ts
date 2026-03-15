import { Actor, log } from 'apify';
import type { ActorInput, EnrichSource, LandRegistryRecord, PropertyListing, LinkedInRecord } from './types.js';
import { PROPERTY_SIC_CODES } from './types.js';
import { enrichFromCompaniesHouse } from './companiesHouse.js';
import { enrichFromLandRegistry } from './landRegistry.js';
import { enrichFromPropertyListings } from './propertyListings.js';
import { enrichFromLinkedIn } from './linkedin.js';
import { mergeLeadRecord } from './merge.js';

await Actor.init();

try {
    const input = (await Actor.getInput<ActorInput>()) ?? {
        searchQuery: 'Cardiff',
        searchType: 'postcode' as const,
        enrichSources: ['companiesHouse', 'landRegistry'] as EnrichSource[],
        maxResults: 10,
    };

    const { searchQuery, searchType, enrichSources, maxResults, proxyConfiguration } = input;

    log.info('Starting property lead enrichment', { searchQuery, searchType, enrichSources, maxResults });
    Actor.setStatusMessage?.('Starting enrichment run...');

    // Step 1: Companies House is always the seed source
    const chResult = await enrichFromCompaniesHouse(searchQuery, searchType, maxResults, PROPERTY_SIC_CODES);

    if (chResult.companies.length === 0) {
        log.warning('No property companies found — ending run');
        Actor.setStatusMessage?.('No property companies found');
        await Actor.exit();
    }

    log.info(`Found ${chResult.companies.length} property companies to enrich`);
    Actor.setStatusMessage?.(`Enriching ${chResult.companies.length} companies...`);

    // Step 2: Dedup check via Key-Value Store
    const store = await Actor.openKeyValueStore('dedup-store');

    for (const company of chResult.companies) {
        const dedupKey = `reg-${company.registrationNumber}`;
        const existing = await store.getValue(dedupKey);

        if (existing) {
            log.info(`Skipping already-enriched company: ${company.companyName} (${company.registrationNumber})`);
            continue;
        }

        const officers = chResult.officers.get(company.registrationNumber) ?? [];
        const activeSources: EnrichSource[] = ['companiesHouse'];

        // Step 3: Run enrichment sources in parallel
        const enrichmentTasks: Promise<unknown>[] = [];

        const landRegistryPromise: Promise<LandRegistryRecord | null> = enrichSources.includes('landRegistry')
            ? enrichFromLandRegistry(
                  company.registeredAddress ?? searchQuery,
                  searchType === 'postcode',
              ).then((r) => {
                  if (r) activeSources.push('landRegistry');
                  return r;
              })
            : Promise.resolve(null);
        enrichmentTasks.push(landRegistryPromise);

        const listingsPromise: Promise<PropertyListing[]> = enrichSources.includes('propertyListings')
            ? enrichFromPropertyListings(
                  company.registeredAddress ?? searchQuery,
                  proxyConfiguration,
              ).then((r) => {
                  if (r.length > 0) activeSources.push('propertyListings');
                  return r;
              })
            : Promise.resolve([]);
        enrichmentTasks.push(listingsPromise);

        const directorNames = officers.map((o) => o.directorName);
        const linkedInPromise: Promise<Map<string, LinkedInRecord>> = enrichSources.includes('linkedin')
            ? enrichFromLinkedIn(directorNames, proxyConfiguration).then((r) => {
                  if (r.size > 0) activeSources.push('linkedin');
                  return r;
              })
            : Promise.resolve(new Map());
        enrichmentTasks.push(linkedInPromise);

        // Wait for all enrichment sources (allSettled so one failure won't crash the run)
        const results = await Promise.allSettled(enrichmentTasks);

        const landRegistry = results[0].status === 'fulfilled' ? (results[0].value as LandRegistryRecord | null) : null;
        const listings = results[1].status === 'fulfilled' ? (results[1].value as PropertyListing[]) : [];
        const linkedInMap = results[2].status === 'fulfilled' ? (results[2].value as Map<string, LinkedInRecord>) : new Map();

        // Get LinkedIn record for primary director
        const primaryDirector = officers.find((o) => o.role === 'director') ?? officers[0];
        const linkedIn = primaryDirector ? (linkedInMap.get(primaryDirector.directorName) ?? null) : null;

        // Step 4: Merge into unified LeadRecord
        const lead = mergeLeadRecord({
            company,
            officers,
            landRegistry,
            listings,
            linkedIn,
            sources: activeSources,
        });

        await Actor.pushData(lead);
        await store.setValue(dedupKey, { enrichedAt: lead.enrichedAt });

        log.info(`Enriched and pushed lead: ${company.companyName}`, { sources: activeSources });
    }

    Actor.setStatusMessage?.(`Run complete. Enriched ${chResult.companies.length} leads.`);
    log.info('Enrichment run complete');
} catch (error) {
    log.error('Actor run failed', { error: String(error) });
    throw error;
} finally {
    await Actor.exit();
}
