import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { promisify } from 'util';

interface PageWithStatus extends Page {
    isBusy: boolean;
}

type ScrapperFunction<T> = (page: Page, ...args: any[]) => Promise<T>;

export class Scrapper {
    private browser: Browser | null = null;
    private pagePool: PageWithStatus[] = [];
    private poolSize: number;
    private pageAvailableResolvers: ((page: PageWithStatus) => void)[] = [];
    private rateLimiter: (() => Promise<void>) | null = null;

    constructor(poolSize: number = 5, requestsPerMinute: number = 60) {
        this.poolSize = poolSize;
        this.setupRateLimiter(requestsPerMinute);
    }

    private setupRateLimiter(requestsPerMinute: number) {
        const interval = 60000 / requestsPerMinute;
        let lastRequestTime = Date.now();
        this.rateLimiter = async () => {
            const now = Date.now();
            const timeToWait = interval - (now - lastRequestTime);
            if (timeToWait > 0) {
                await promisify(setTimeout)(timeToWait);
            }
            lastRequestTime = Date.now();
        };
    }

    public async openBrowser(): Promise<void> {
        puppeteer.use(StealthPlugin());

        this.browser = await puppeteer.launch({
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: false,
            defaultViewport: null,
        });

        const pages = await this.browser.pages();
        await pages[0].close();

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

    private async createNewPage(): Promise<PageWithStatus> {
        if (!this.browser) {
            throw new Error('Browser is not open. Call openBrowser() first.');
        }

        const page = await this.browser.newPage();
        const pageWithStatus = page as PageWithStatus;
        pageWithStatus.isBusy = false;

        await pageWithStatus.setRequestInterception(true);
        pageWithStatus.on('request', (request) => {
            const resourceType = request.resourceType();
            if (resourceType === 'stylesheet' || resourceType === 'image' || resourceType === 'font') {
                request.abort();
            } else {
                request.continue();
            }
        });
        await pageWithStatus.goto('about:blank');

        return pageWithStatus;
    }

    private async getPageFromPool(): Promise<PageWithStatus> {
        const page = this.pagePool.find((p) => !p.isBusy);
        if (page) {
            page.isBusy = true;
            return page;
        }

        return new Promise((resolve) => {
            this.pageAvailableResolvers.push(resolve);
        });
    }

    private returnPageToPool(page: PageWithStatus): void {
        page.isBusy = false;

        const resolver = this.pageAvailableResolvers.shift();
        if (resolver) {
            resolver(page);
        }
    }

    private async handleError(error: any, page: Page): Promise<Page> {
        console.error('Handling error:', error.message);
        if (error.name === 'TimeoutError') {
            console.log('Reloading page due to timeout');
            await page.reload({ waitUntil: 'networkidle0' });
        } else if (error.message.includes('net::ERR_CONNECTION_CLOSED') ||
            error.message.includes('Execution context was destroyed')) {
            console.log('Creating new page due to connection error or destroyed context');
            await page.close();
            return await this.createNewPage();
        } else {
            try {
                const errorText = await page.evaluate(() => document.body.textContent);
                if (errorText?.includes('404')) {
                    throw new Error('Page not found');
                }
            } catch (evalError) {
                console.error('Error while checking for 404:', evalError);
            }
        }
        return page;
    }

    public async run<T>(customFunction: ScrapperFunction<T>, args: any[], retries = 3): Promise<T> {
        const page = await this.getPageFromPool();
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                if (this.rateLimiter) await this.rateLimiter();
                const result = await customFunction(page, ...args);
                this.returnPageToPool(page);
                return result;
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error);
                if (attempt === retries) {
                    this.returnPageToPool(page);
                    throw error;
                }
                await this.handleError(error, page);
            }
        }
        throw new Error('Unexpected error: All retries failed');
    }

    private async runSingleTask<T>(task: { func: ScrapperFunction<T>; args: any[] }, retries = 3): Promise<T> {
        const page = await this.getPageFromPool();
        let currentPage = page;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                if (this.rateLimiter) await this.rateLimiter();

                const result = await task.func(currentPage, ...task.args);
                this.returnPageToPool(currentPage as PageWithStatus);
                return result;
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error);
                if (attempt === retries) {
                    this.returnPageToPool(currentPage as PageWithStatus);
                    throw error;
                }
                currentPage = await this.handleError(error, currentPage) as PageWithStatus;

                // If we've created a new page, update our pool
                if (this.pagePool.indexOf(currentPage as PageWithStatus) === -1) {
                    this.pagePool[this.pagePool.indexOf(page as PageWithStatus)] = currentPage as PageWithStatus;
                }
            }
        }
        throw new Error('Unexpected error: All retries failed');
    }

    public async runConcurrent<T>(
        tasks: Array<{ func: ScrapperFunction<T>; args: any[] }>,
        concurrency = this.poolSize
    ): Promise<Array<T | { error: any }>> {
        const results: Array<T | { error: any }> = [];
        const runningTasks: Array<{ promise: Promise<void>; done: boolean }> = [];

        const runTask = async (task: { func: ScrapperFunction<T>; args: any[] }) => {
            try {
                const result = await this.runSingleTask(task);
                results.push(result);
            } catch (error) {
                console.error('Task failed after all retries:', error);
                results.push({ error });
            }
        };

        for (const task of tasks) {
            if (runningTasks.filter(t => !t.done).length >= concurrency) {
                await Promise.race(runningTasks.filter(t => !t.done).map(t => t.promise));
            }

            const taskWrapper = {
                promise: runTask(task).then(() => { taskWrapper.done = true; }),
                done: false
            };
            runningTasks.push(taskWrapper);
        }

        await Promise.all(runningTasks.map(t => t.promise));
        return results;
    }
}