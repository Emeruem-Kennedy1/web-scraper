import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

interface PageWithStatus extends Page {
    isBusy: boolean;
}

type ScrapperFunction = (page: Page, ...args: any[]) => Promise<any>;

export class Scrapper {
    private browser: Browser | null = null;
    private pagePool: PageWithStatus[] = [];
    private poolSize: number;
    private pageAvailableResolvers: ((page: PageWithStatus) => void)[] = [];

    constructor(poolSize: number = 5) {
        this.poolSize = poolSize;
    }

    public async openBrowser(): Promise<void> {
        puppeteer.use(StealthPlugin());
        this.browser = await puppeteer.launch({ headless: false });

        // close the initial tab
        const pages = await this.browser.pages();
        await pages[0].close();

        // Create the page pool
        await this.initializePagePool();
    }

    public async closeBrowser(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    private async initializePagePool(): Promise<void> {
        if (!this.browser) {
            throw new Error('Browser is not open. Call openBrowser() first.');
        }
        for (let i = 0; i < this.poolSize; i++) {
            const page = await this.createNewPage();
            this.pagePool.push(page);
        }
    }

    /**
     * Create a new page object in the browser
     * @returns A new page object
     */
    private async createNewPage(): Promise<PageWithStatus> {
        if (!this.browser) {
            throw new Error('Browser is not open. Call openBrowser() first.');
        }

        const page = await this.browser.newPage() as PageWithStatus;
        page.isBusy = false;

        // Request interception to block CSS, images, and fonts
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (resourceType === 'stylesheet' || resourceType === 'image' || resourceType === 'font') {
                request.abort();
            } else {
                request.continue();
            }
        });

        return page;
    }

    private async getPageFromPool(): Promise<PageWithStatus> {
        // Find the first available page
        const page = this.pagePool.find((p) => !p.isBusy);
        if (page) {
            page.isBusy = true;
            return page;
        }

        // If no page is available, wait for one to be released
        return new Promise((resolve) => {
            this.pageAvailableResolvers.push(resolve);
        });
    }

    private returnPageToPool(page: PageWithStatus): void {
        // Set the page as available
        page.isBusy = false;

        // Resolve the next waiting promise if any
        const resolver = this.pageAvailableResolvers.shift();
        if (resolver) {
            resolver(page);
        }
    }

    /**
     * Run a custom function that scrapes a webpage
     * @param customFunction The scrapping function we want to run
     * @param args The arguments to pass to the customFunction
     * @param retries How many times to retry the customFunction if it fails
     * @returns The result of the customFunction
     */
    public async run(customFunction: ScrapperFunction, args: any[], retries = 3): Promise<any> {
        const page = await this.getPageFromPool();
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const result = await customFunction(page, ...args);
                this.returnPageToPool(page);
                return result;
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error);
                if (attempt === retries) {
                    this.returnPageToPool(page);
                    throw error;
                }
            }
        }
    }
}