export type SearchType = 'postcode' | 'companyName' | 'directorName';

export type EnrichSource = 'companiesHouse' | 'landRegistry' | 'propertyListings' | 'linkedin';

export interface ActorInput {
    searchQuery: string;
    searchType: SearchType;
    enrichSources: EnrichSource[];
    maxResults: number;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
    };
}

export interface CompanyRecord {
    companyName: string;
    registrationNumber: string;
    sicCodes: string[];
    companyStatus: string;
    incorporationDate: string | null;
    registeredAddress: string | null;
}

export interface OfficerRecord {
    directorName: string;
    role: string;
    appointedOn: string | null;
    nationality: string | null;
}

export interface LandRegistryRecord {
    totalTransactions: number;
    lastTransactionDate: string | null;
    estimatedPortfolioValue: number;
    transactions: LandRegistryTransaction[];
}

export interface LandRegistryTransaction {
    address: string;
    pricePaid: number;
    transactionDate: string;
    propertyType: string;
}

export interface PropertyListing {
    title: string;
    price: string;
    address: string;
    url: string;
    source: 'rightmove' | 'zoopla';
}

export interface LinkedInRecord {
    linkedInUrl: string | null;
    linkedInRole: string | null;
    linkedInCompany: string | null;
}

export interface LeadRecord {
    leadId: string;
    companyName: string | null;
    registrationNumber: string | null;
    sicCodes: string[];
    companyStatus: string | null;
    incorporationDate: string | null;
    registeredAddress: string | null;
    directorName: string | null;
    directorRole: string | null;
    directorAppointedOn: string | null;
    totalTransactions: number;
    lastTransactionDate: string | null;
    estimatedPortfolioValue: number;
    activeListings: PropertyListing[];
    linkedInUrl: string | null;
    linkedInRole: string | null;
    outreachStatus: 'new' | 'contacted' | 'replied' | 'converted';
    enrichedAt: string;
    sources: EnrichSource[];
}

/** Property-related SIC codes for filtering */
export const PROPERTY_SIC_CODES = ['68100', '68209', '68320', '41100'];
