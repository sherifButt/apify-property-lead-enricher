import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { ProxyConfiguration } from 'apify';
import type { LinkedInRecord } from './types.js';

const MAX_LOOKUPS = 30;
const MIN_DELAY_MS = 3000;
const MIN_NAME_WORDS = 3;

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export async function enrichFromLinkedIn(
    directorNames: string[],
    proxyConfig?: { useApifyProxy?: boolean; apifyProxyGroups?: string[] },
): Promise<Map<string, LinkedInRecord>> {
    log.info('Starting LinkedIn enrichment...', { totalNames: directorNames.length });
    Actor.setStatusMessage?.('Enriching from LinkedIn...');

    const results = new Map<string, LinkedInRecord>();

    const validNames = directorNames
        .filter((name) => name.split(/\s+/).length >= MIN_NAME_WORDS)
        .slice(0, MAX_LOOKUPS);

    if (validNames.length === 0) {
        log.info('No valid director names for LinkedIn lookup');
        return results;
    }

    log.info(`Processing ${validNames.length} LinkedIn lookups (from ${directorNames.length} total)`);

    const proxyConfiguration = proxyConfig?.useApifyProxy
        ? new ProxyConfiguration({
              groups: proxyConfig.apifyProxyGroups ?? ['RESIDENTIAL'],
          })
        : undefined;

    for (const name of validNames) {
        try {
            const record = await lookupLinkedInProfile(name, proxyConfiguration);
            results.set(name, record);
            await delay(MIN_DELAY_MS);
        } catch (error) {
            log.warning(`LinkedIn lookup failed for ${name}`, { error: String(error) });
            results.set(name, { linkedInUrl: null, linkedInRole: null, linkedInCompany: null });
        }
    }

    return results;
}

async function lookupLinkedInProfile(
    name: string,
    proxyConfiguration?: ProxyConfiguration,
): Promise<LinkedInRecord> {
    const result: LinkedInRecord = {
        linkedInUrl: null,
        linkedInRole: null,
        linkedInCompany: null,
    };

    const searchQuery = encodeURIComponent(`${name} property site:linkedin.com/in`);
    const googleSearchUrl = `https://www.google.com/search?q=${searchQuery}`;

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: 30,
        async requestHandler({ $ }) {
            const firstLinkedInLink = $('a[href*="linkedin.com/in/"]').first().attr('href');
            if (firstLinkedInLink) {
                const match = firstLinkedInLink.match(/(https?:\/\/[a-z]+\.linkedin\.com\/in\/[^&?]+)/);
                if (match) {
                    result.linkedInUrl = match[1];
                }
            }
        },
        failedRequestHandler({ request }) {
            log.warning(`LinkedIn search failed: ${request.url}`);
        },
    });

    await crawler.run([googleSearchUrl]);

    if (result.linkedInUrl) {
        const profileCrawler = new CheerioCrawler({
            proxyConfiguration,
            maxRequestsPerCrawl: 1,
            requestHandlerTimeoutSecs: 30,
            async requestHandler({ $ }) {
                result.linkedInRole =
                    $('h2.top-card-layout__headline').first().text().trim() || null;
                result.linkedInCompany =
                    $('h2.top-card-layout__headline + div a').first().text().trim() || null;
            },
            failedRequestHandler() {
                log.warning('LinkedIn profile fetch failed');
            },
        });

        await profileCrawler.run([result.linkedInUrl]);
    }

    return result;
}
