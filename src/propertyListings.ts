import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { ProxyConfiguration } from 'apify';
import type { PropertyListing } from './types.js';

const MAX_PAGES = 3;

function randomDelay(): Promise<void> {
    const ms = 2000 + Math.random() * 3000;
    return new Promise((r) => setTimeout(r, ms));
}

export async function enrichFromPropertyListings(
    searchTerm: string,
    proxyConfig?: { useApifyProxy?: boolean; apifyProxyGroups?: string[] },
): Promise<PropertyListing[]> {
    log.info('Scraping property listings...', { searchTerm });
    Actor.setStatusMessage?.('Scraping property listings...');

    const listings: PropertyListing[] = [];

    const proxyConfiguration = proxyConfig?.useApifyProxy
        ? new ProxyConfiguration({
              groups: proxyConfig.apifyProxyGroups ?? ['RESIDENTIAL'],
          })
        : undefined;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxRequestsPerCrawl: MAX_PAGES,
        requestHandlerTimeoutSecs: 60,
        headless: true,
        launchContext: {
            launchOptions: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
        },
        async requestHandler({ page, request }) {
            log.info(`Scraping ${request.url}`);

            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

            if (request.url.includes('rightmove.co.uk')) {
                const cards = await page.$$('.l-searchResult');
                for (const card of cards) {
                    const title = await card.$eval('.propertyCard-title', (el) => el.textContent?.trim() ?? '').catch(() => '');
                    const price = await card.$eval('.propertyCard-priceValue', (el) => el.textContent?.trim() ?? '').catch(() => '');
                    const address = await card.$eval('.propertyCard-address', (el) => el.textContent?.trim() ?? '').catch(() => '');
                    const link = await card.$eval('a.propertyCard-link', (el) => el.getAttribute('href') ?? '').catch(() => '');

                    if (title || address) {
                        listings.push({
                            title,
                            price,
                            address,
                            url: link.startsWith('http') ? link : `https://www.rightmove.co.uk${link}`,
                            source: 'rightmove',
                        });
                    }
                }
            }

            if (request.url.includes('zoopla.co.uk')) {
                const cards = await page.$$('[data-testid="search-result"]');
                for (const card of cards) {
                    const title = await card.$eval('h2', (el) => el.textContent?.trim() ?? '').catch(() => '');
                    const price = await card.$eval('[data-testid="listing-price"]', (el) => el.textContent?.trim() ?? '').catch(() => '');
                    const address = await card.$eval('address', (el) => el.textContent?.trim() ?? '').catch(() => '');
                    const link = await card.$eval('a', (el) => el.getAttribute('href') ?? '').catch(() => '');

                    if (title || address) {
                        listings.push({
                            title,
                            price,
                            address,
                            url: link.startsWith('http') ? link : `https://www.zoopla.co.uk${link}`,
                            source: 'zoopla',
                        });
                    }
                }
            }

            await randomDelay();
        },
        failedRequestHandler({ request }) {
            log.warning(`Request failed: ${request.url}`);
        },
    });

    try {
        const encodedSearch = encodeURIComponent(searchTerm);
        await crawler.run([
            `https://www.rightmove.co.uk/house-prices/${encodedSearch}.html`,
            `https://www.zoopla.co.uk/house-prices/${encodedSearch}/`,
        ]);
    } catch (error) {
        log.error('Property listings scraping failed', { error: String(error) });
    }

    log.info(`Found ${listings.length} property listings`);
    return listings;
}
