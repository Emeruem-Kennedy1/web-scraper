import { Page } from "puppeteer";
import { BASE_URL } from "../configs/configs.json";

const siteMapUrl = `${BASE_URL}/sitemap/artist`;
// const categoriesSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1".split("");

/**
 * 
 * @param page Page Object from Puppeteer
 * @param category The category to get the number of pages for eg [A-Z, 1]
 * @param callback Callback function to be called after the page has been loaded
 * @returns 
 */
async function getNumberOfPagesForCategory(page: Page, category: string, callback = () => { }) {
    await page.goto(`${siteMapUrl}/${category}`, { waitUntil: "domcontentloaded" });
    const count = await page.evaluate(() => {
        const div = document.querySelector(".fullContent");
        const aTags = div ? div.querySelectorAll("a") : [];
        const filteredATags = Array.from(aTags).filter((a) => {
            return a.getAttribute("href")?.match(/\/sitemap\/artist\/[A-Z 0-9]\/\d+/);
        });
        return filteredATags.length
    });

    callback();
    return count;
}

async function getArtistsOnPage(page: Page, category: string, pageNumber: number, callback = () => { }) {
    await page.goto(`${siteMapUrl}/${category}/${pageNumber}`, { waitUntil: "domcontentloaded" });
    const artists = await page.evaluate(() => {
        const div = document.querySelector(".fullContent");
        const aTags = div ? div.querySelectorAll("a") : [];
        const artistNames = Array.from(aTags).map((a) => a.textContent);
        return artistNames;
    });

    callback();
    return artists;
}

export { getNumberOfPagesForCategory, getArtistsOnPage }; 