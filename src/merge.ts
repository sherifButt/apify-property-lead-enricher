import { v4 as uuidv4 } from 'uuid';
import type {
    CompanyRecord,
    OfficerRecord,
    LandRegistryRecord,
    PropertyListing,
    LinkedInRecord,
    LeadRecord,
    EnrichSource,
} from './types.js';

interface MergeInput {
    company: CompanyRecord;
    officers: OfficerRecord[];
    landRegistry: LandRegistryRecord | null;
    listings: PropertyListing[];
    linkedIn: LinkedInRecord | null;
    sources: EnrichSource[];
}

export function mergeLeadRecord(input: MergeInput): LeadRecord {
    const { company, officers, landRegistry, listings, linkedIn, sources } = input;

    const primaryDirector = officers.find((o) => o.role === 'director') ?? officers[0] ?? null;

    return {
        leadId: uuidv4(),
        companyName: company.companyName,
        registrationNumber: company.registrationNumber,
        sicCodes: company.sicCodes,
        companyStatus: company.companyStatus,
        incorporationDate: company.incorporationDate,
        registeredAddress: company.registeredAddress,
        directorName: primaryDirector?.directorName ?? null,
        directorRole: primaryDirector?.role ?? null,
        directorAppointedOn: primaryDirector?.appointedOn ?? null,
        totalTransactions: landRegistry?.totalTransactions ?? 0,
        lastTransactionDate: landRegistry?.lastTransactionDate ?? null,
        estimatedPortfolioValue: landRegistry?.estimatedPortfolioValue ?? 0,
        activeListings: listings,
        linkedInUrl: linkedIn?.linkedInUrl ?? null,
        linkedInRole: linkedIn?.linkedInRole ?? null,
        outreachStatus: 'new',
        enrichedAt: new Date().toISOString(),
        sources,
    };
}
