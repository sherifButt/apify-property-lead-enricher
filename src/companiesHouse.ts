import { Actor, log } from 'apify';
import type { CompanyRecord, OfficerRecord, SearchType } from './types.js';

const BASE_URL = 'https://api.company-information.service.gov.uk';

interface CompaniesHouseResult {
    companies: CompanyRecord[];
    officers: Map<string, OfficerRecord[]>;
}

async function fetchWithRetry(url: string, apiKey: string, retries = 3): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
                },
            });

            if (response.status === 429) {
                const delay = Math.pow(2, attempt) * 1000;
                log.warning(`Rate limited, retrying in ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            const delay = Math.pow(2, attempt) * 1000;
            log.warning(`Request failed, retrying in ${delay}ms...`, { error: String(error) });
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    throw new Error(`Failed after ${retries + 1} attempts`);
}

async function searchCompanies(
    query: string,
    _searchType: SearchType,
    apiKey: string,
    maxResults: number,
): Promise<CompanyRecord[]> {
    const searchParam = encodeURIComponent(query);
    const url = `${BASE_URL}/search/companies?q=${searchParam}&items_per_page=${maxResults}`;

    const response = await fetchWithRetry(url, apiKey);
    if (!response.ok) {
        log.error(`Companies House search failed: ${response.status}`);
        return [];
    }

    const data = (await response.json()) as {
        items: Array<{
            title: string;
            company_number: string;
            company_status: string;
            sic_codes?: string[];
            date_of_creation?: string;
            registered_office_address?: {
                address_line_1?: string;
                address_line_2?: string;
                locality?: string;
                postal_code?: string;
                region?: string;
            };
        }>;
    };

    if (!data.items?.length) {
        log.info('No companies found for query', { query });
        return [];
    }

    return data.items.map((item) => {
        const addr = item.registered_office_address;
        const addressParts = [
            addr?.address_line_1,
            addr?.address_line_2,
            addr?.locality,
            addr?.region,
            addr?.postal_code,
        ].filter(Boolean);

        return {
            companyName: item.title,
            registrationNumber: item.company_number,
            sicCodes: item.sic_codes ?? [],
            companyStatus: item.company_status,
            incorporationDate: item.date_of_creation ?? null,
            registeredAddress: addressParts.length > 0 ? addressParts.join(', ') : null,
        };
    });
}

function filterByPropertySicCodes(companies: CompanyRecord[], propertySicCodes: string[]): CompanyRecord[] {
    return companies.filter((company) => company.sicCodes.some((sic) => propertySicCodes.includes(sic)));
}

async function getOfficers(companyNumber: string, apiKey: string): Promise<OfficerRecord[]> {
    const url = `${BASE_URL}/company/${companyNumber}/officers`;

    const response = await fetchWithRetry(url, apiKey);
    if (!response.ok) {
        log.warning(`Failed to fetch officers for ${companyNumber}: ${response.status}`);
        return [];
    }

    const data = (await response.json()) as {
        items: Array<{
            name: string;
            officer_role: string;
            appointed_on?: string;
            nationality?: string;
        }>;
    };

    if (!data.items?.length) return [];

    return data.items.map((item) => ({
        directorName: item.name,
        role: item.officer_role,
        appointedOn: item.appointed_on ?? null,
        nationality: item.nationality ?? null,
    }));
}

export async function enrichFromCompaniesHouse(
    query: string,
    searchType: SearchType,
    maxResults: number,
    propertySicCodes: string[],
): Promise<CompaniesHouseResult> {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
        log.error('COMPANIES_HOUSE_API_KEY not set');
        return { companies: [], officers: new Map() };
    }

    log.info('Searching Companies House...', { query, searchType });
    Actor.setStatusMessage?.('Searching Companies House...');

    const allCompanies = await searchCompanies(query, searchType, apiKey, maxResults);
    const propertyCompanies = filterByPropertySicCodes(allCompanies, propertySicCodes);

    log.info(`Found ${propertyCompanies.length} property companies (from ${allCompanies.length} total)`);

    const officers = new Map<string, OfficerRecord[]>();
    for (const company of propertyCompanies) {
        const companyOfficers = await getOfficers(company.registrationNumber, apiKey);
        officers.set(company.registrationNumber, companyOfficers);
    }

    return { companies: propertyCompanies, officers };
}
