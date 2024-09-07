import { Scrapper } from "./scrapper";
import { getArtistsOnPage } from "./get_artists";
import { PrismaClient } from "@prisma/client";
// const categoriesSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1".split("");

const prisma = new PrismaClient();

const webScrapper = new Scrapper(10);

// const categoryMap = new Map<string, number>();

async function main() {
  try {
    const newArtist = await prisma.artist.create({
      data: {
        name: "Test Artist",
      }
    })
    console.log("Created Artist", newArtist);

    // find artist
    const artist = await prisma.artist.findMany({
      where: {
        name: "Test Artist",
      }
    });
    console.log(artist);
    await webScrapper.openBrowser();

    // const promises = categoriesSet.map(async (category) => {
    //   const result = await webScrapper.run(getNumberOfPagesForCategory, [category]);
    //   categoryMap.set(category, result);
    // });
    // await Promise.all(promises);
    // console.log(categoryMap, "Total Pages", [...categoryMap.values()].reduce((acc, val) => acc + val, 0));

    const res = await webScrapper.run(getArtistsOnPage, ["A", 1]);
    console.log(res);

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
}).catch((e) => {
  console.error(e);
}).finally(async () => {
  await prisma.$disconnect();
});