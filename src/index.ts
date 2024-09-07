import { Scrapper } from "./scrapper";
import { getNumberOfPagesForCategory } from "./get_artists";
const categoriesSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1".split("");

const webScrapper = new Scrapper(10);

const categoryMap = new Map<string, number>();

async function main() {
  try {
    await webScrapper.openBrowser();

    const promises = categoriesSet.map(async (category) => {
      const result = await webScrapper.run(getNumberOfPagesForCategory, [category]);
      categoryMap.set(category, result);
    });
    await Promise.all(promises);
    console.log(categoryMap, "Total Pages", [...categoryMap.values()].reduce((acc, val) => acc + val, 0));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await webScrapper.closeBrowser();
  }
}

// time the execution
console.time("Execution Time");
main().then(() => {
  console.timeEnd("Execution Time");
});
