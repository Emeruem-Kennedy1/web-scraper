import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

type ScrapperFunction = (page: Page, ...args: any[]) => Promise<any>;

export class Scrapper {
    private browser: Browser | null = null;

    public async openBrowser(): Promise<void> {
        puppeteer.use(StealthPlugin());
        this.browser = await puppeteer.launch({ headless: true });
    }

    public async closeBrowser(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Create a new page object in the browser
     * @returns A new page object
     */
    public async createPage(): Promise<Page> {
        if (!this.browser) {
            throw new Error('Browser is not open. Call openBrowser() first.');
        }
        return await this.browser.newPage();
    }

    /**
        Run a custom function that scrapes a webpage
     * @param customFunction The scrapping function we want to run
     * @param args The arguments to pass to the customFunction
     * @param retries How many times to retry the customFunction if it fails
     * @returns The result of the customFunction
     */
    public async run(customFunction: ScrapperFunction, args: any[], retries = 3): Promise<any> {
        const page = await this.createPage();
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const result = await customFunction(page, ...args);
                await page.close();
                return result;
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error);
                if (attempt === retries) {
                    await page.close();
                    throw error;
                }
            }
        }
    }
}