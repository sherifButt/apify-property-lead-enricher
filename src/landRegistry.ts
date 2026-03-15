import { Actor, log } from 'apify';
import type { LandRegistryRecord, LandRegistryTransaction } from './types.js';

const SPARQL_ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query';

async function fetchWithRetry(url: string, body: string, retries = 3): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body,
            });

            if (response.status === 429 || response.status >= 500) {
                const delay = Math.pow(2, attempt) * 1000;
                log.warning(`Land Registry request failed (${response.status}), retrying in ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            const delay = Math.pow(2, attempt) * 1000;
            log.warning(`Land Registry request error, retrying in ${delay}ms...`, { error: String(error) });
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    throw new Error(`Failed after ${retries + 1} attempts`);
}

function buildSparqlQuery(searchTerm: string, searchByPostcode: boolean): string {
    const filterClause = searchByPostcode
        ? `FILTER(CONTAINS(UCASE(?address), UCASE("${searchTerm}")))`
        : `FILTER(CONTAINS(UCASE(?address), UCASE("${searchTerm}")))`;

    return `
        PREFIX ppd: <http://landregistry.data.gov.uk/def/ppi/>
        PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>

        SELECT ?address ?pricePaid ?transactionDate ?propertyType
        WHERE {
            ?transaction ppd:pricePaid ?pricePaid ;
                         ppd:transactionDate ?transactionDate ;
                         ppd:propertyAddress ?addressObj ;
                         ppd:propertyType ?propertyTypeUri .

            ?addressObj lrcommon:paon ?paon .
            ?addressObj lrcommon:street ?street .
            ?addressObj lrcommon:postcode ?postcode .

            BIND(CONCAT(?paon, " ", ?street, ", ", ?postcode) AS ?address)
            BIND(REPLACE(STR(?propertyTypeUri), ".*#", "") AS ?propertyType)

            ${filterClause}
        }
        ORDER BY DESC(?transactionDate)
        LIMIT 100
    `;
}

export async function enrichFromLandRegistry(
    searchTerm: string,
    searchByPostcode: boolean,
): Promise<LandRegistryRecord | null> {
    log.info('Querying Land Registry...', { searchTerm, searchByPostcode });
    Actor.setStatusMessage?.('Querying Land Registry...');

    try {
        const query = buildSparqlQuery(searchTerm, searchByPostcode);
        const body = `query=${encodeURIComponent(query)}`;

        const response = await fetchWithRetry(SPARQL_ENDPOINT, body);
        if (!response.ok) {
            log.error(`Land Registry query failed: ${response.status}`);
            return null;
        }

        const data = (await response.json()) as {
            results: {
                bindings: Array<{
                    address: { value: string };
                    pricePaid: { value: string };
                    transactionDate: { value: string };
                    propertyType: { value: string };
                }>;
            };
        };

        const bindings = data.results?.bindings ?? [];

        if (bindings.length === 0) {
            log.info('No Land Registry transactions found', { searchTerm });
            return {
                totalTransactions: 0,
                lastTransactionDate: null,
                estimatedPortfolioValue: 0,
                transactions: [],
            };
        }

        const transactions: LandRegistryTransaction[] = bindings.map((b) => ({
            address: b.address.value,
            pricePaid: parseFloat(b.pricePaid.value),
            transactionDate: b.transactionDate.value,
            propertyType: b.propertyType.value,
        }));

        const totalValue = transactions.reduce((sum, t) => sum + t.pricePaid, 0);

        return {
            totalTransactions: transactions.length,
            lastTransactionDate: transactions[0]?.transactionDate ?? null,
            estimatedPortfolioValue: totalValue,
            transactions,
        };
    } catch (error) {
        log.error('Land Registry enrichment failed', { error: String(error) });
        return null;
    }
}
