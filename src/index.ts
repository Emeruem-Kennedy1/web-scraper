import { Scrapper } from "./scrapper"; // Adjust the import path as needed
import fs from "fs/promises";
import path from "path";
import { getNumberOfPagesForCategory, getArtistsOnPage } from "./get_artists";
import * as winston from "winston";
import { PrismaClient } from "@prisma/client";
import { buildUrl, buildSongUrl, buildSamplePageUrl } from "./build_url";
import {
  getArtistContentOnPage,
  getSampledInContentOnPage,
  getAllArtistContent,
  getAllSampledInContent,
  scrapeSongDetailsPage,
  scrapeComprehensiveSongDetails,
} from "./get_songs";

// const categoriesSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1".split("");
const categoriesSet = "B".split("");
const prisma = new PrismaClient();

// Setup logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "scraper.log" }),
    new winston.transports.Console(),
  ],
});

// async function saveArtistsToDatabase(artists: string[]) {
//   for (const artistName of artists) {
//     await prisma.artist.upsert({
//       where: { name: artistName },
//       update: {},
//       create: { name: artistName }
//     });
//   }
// }

async function saveArtistsToDatabase(artists: string[]) {
  // Remove duplicates from the input array
  const uniqueArtists = [...new Set(artists)];

  // Find existing artists
  const existingArtists = await prisma.artist.findMany({
    where: {
      name: { in: uniqueArtists },
    },
    select: { name: true },
  });

  const existingArtistNames = new Set(
    existingArtists.map((artist) => artist.name)
  );

  // Filter out artists that already exist
  const newArtists = uniqueArtists.filter(
    (name) => !existingArtistNames.has(name)
  );

  // Bulk create new artists
  if (newArtists.length > 0) {
    await prisma.artist.createMany({
      data: newArtists.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  // If you need to update existing artists, you can do so here
  // For example, if you want to update a 'lastSeen' field:
  /*
  if (existingArtists.length > 0) {
    await prisma.$transaction(
      existingArtists.map(artist => 
        prisma.artist.update({
          where: { name: artist.name },
          data: { lastSeen: new Date() }
        })
      )
    );
  }
  */

  console.log(
    `Processed ${uniqueArtists.length} artists. Created ${newArtists.length} new artists.`
  );
}

async function readProgressLog() {
  try {
    const content = await fs.readFile("progress.json", "utf-8");
    return JSON.parse(content);
  } catch (error) {
    logger.warn("Failed to read progress log, starting from the beginning");
    return {};
  }
}

async function writeProgressLog(progress: any) {
  await fs.writeFile("progress.json", JSON.stringify(progress, null, 2));
}

async function getLastSuccessfulPage(
  category: string,
  progress: Record<string, number>
): Promise<number> {
  const lastPage = progress[category] || 0;
  console.log(`Last successful page for category ${category}: ${lastPage}`);
  return lastPage;
}

async function scrapeCategoriesPageCounts() {
  const scrapper = new Scrapper(4, 10); // 5 concurrent pages, 60 requests per minute
  await scrapper.openBrowser();

  try {
    const tasks = categoriesSet.map((category) => ({
      func: getNumberOfPagesForCategory,
      args: [
        category,
        () => console.log(`Finished scraping category ${category}`),
      ],
    }));

    const results = await scrapper.runConcurrent(tasks);

    // Process results
    const categoryPageCounts = results.map((result, index) => ({
      category: categoriesSet[index],
      pageCount: result instanceof Error ? 0 : (result as number),
    }));

    console.log("Category Page Counts:");
    console.log(categoryPageCounts);

    // Store results in a JSON file
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const fileName = `category-page-counts-${timestamp}.json`;
    const filePath = path.join(process.cwd(), fileName);

    await fs.writeFile(filePath, JSON.stringify(categoryPageCounts, null, 2));
    console.log(`Results stored in ${fileName}`);

    return filePath; // Return the file path for further use if needed
  } catch (error) {
    console.error("An error occurred during scraping:", error);
    throw error; // Rethrow the error for the caller to handle
  } finally {
    await scrapper.closeBrowser();
  }
}

async function readCategoryPageCounts(filePath: string) {
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

async function scrapeArtists(jsonFilePath: string) {
  const categoryPageCounts = await readCategoryPageCounts(jsonFilePath);
  let progress = await readProgressLog();
  const scrapper = new Scrapper(5, 60); // 5 concurrent pages, 20 requests per minute
  await scrapper.openBrowser();

  try {
    for (const { category, pageCount } of categoryPageCounts) {
      const lastSuccessfulPage = await getLastSuccessfulPage(
        category,
        progress
      );
      console.log(
        `Last successful page for category ${category}: ${lastSuccessfulPage}`
      );
      const startPage = lastSuccessfulPage + 1;
      logger.info(
        `Scraping category ${category} starting from page ${startPage}`
      );

      for (let page = startPage; page <= pageCount; page += 5) {
        // Process in batches of 5
        const endPage = Math.min(page + 4, pageCount);
        const tasks = [];
        for (let p = page; p <= endPage; p++) {
          tasks.push({
            func: getArtistsOnPage,
            args: [
              category,
              p,
              () =>
                logger.info(
                  `Finished scraping category ${category}, page ${p}`
                ),
            ],
          });
        }

        const results = await scrapper.runConcurrent(tasks);

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const currentPage = page + i;

          if ("error" in result) {
            logger.error(
              `Error scraping category ${category}, page ${currentPage}: ${result.error}`
            );
            // Don't break here, continue with the next page
          } else {
            await saveArtistsToDatabase(result as string[]);
            progress[category] = currentPage;
            await writeProgressLog(progress);
          }
        }
      }
    }

    logger.info("Scraping completed successfully");
  } catch (error) {
    logger.error("An error occurred during scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
    await prisma.$disconnect();
  }
}

// // Usage
// const jsonFilePath = '/Users/kennedyemeruem/dev/school_projects/web-scrapper/category-page-counts-2024-09-26T01-41-39.424Z.json'; // Replace with your actual JSON file path
// scrapeArtists(jsonFilePath)
//   .then(() => logger.info('Scraping process finished'))
//   .catch((error) => logger.error('Scraping failed:', error));

// // Run the scraping process
// scrapeCategoriesPageCounts()
//   .then((filePath) => console.log(`Scraping completed. Results stored in ${filePath}`))
//   .catch((error) => console.error("Scraping failed:", error));

async function scrapeArtistSongs(artist: string) {
  const url = buildUrl(artist);
  const scrapper = new Scrapper(1, 60); // 5 concurrent pages, 60 requests per minute
  await scrapper.openBrowser();

  try {
    const artistContent = await scrapper.run(getArtistContentOnPage, [url]);

    const songs = Array.isArray(artistContent)
      ? artistContent
      : artistContent.artistContent;
    for (const song of songs) {
      if (song.mainArtists.length < 1) {
        song.mainArtists = [artist];
      }
    }
    console.log(JSON.stringify(artistContent));
  } catch (error) {
    console.error("An error occurred during scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
  }
}

async function scrapeSampledInSongs(artist: string, song: string) {
  const url = buildSamplePageUrl(artist, song);
  const scrapper = new Scrapper(1, 60);
  await scrapper.openBrowser();

  try {
    const artistContent = await scrapper.run(getSampledInContentOnPage, [url]);
    console.log(JSON.stringify(artistContent));
  } catch (error) {
    console.error("An error occurred during scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
  }
}

async function scrapeAllArtistSongs(artist: string) {
  const baseUrl = buildUrl(artist);
  const scrapper = new Scrapper(1, 60);
  await scrapper.openBrowser();

  try {
    const allSongs = await scrapper.run(getAllArtistContent, [baseUrl, artist]);
    console.log(JSON.stringify(allSongs));
  } catch (error) {
    console.error("An error occurred during scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
  }
}

async function scrapeAllSongsSampledIn(artist: string, song: string) {
  const baseUrl = buildSamplePageUrl(artist, song);
  const scrapper = new Scrapper(1, 60);
  await scrapper.openBrowser();

  try {
    const allSongs = await scrapper.run(getAllSampledInContent, [baseUrl]);
    console.log(JSON.stringify(allSongs));
  } catch (error) {
    console.error("An error occurred during scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
  }
}

async function scrapeMainPage(artist: string, song: string) {
  const baseUrl = buildSongUrl(artist, song);
  console.log(baseUrl);
  const scrapper = new Scrapper(1, 60);
  await scrapper.openBrowser();

  try {
    const allSongs = await scrapper.run(scrapeComprehensiveSongDetails, [
      baseUrl,
    ]);
    console.log(JSON.stringify(allSongs));
  } catch (error) {
    console.error("An error occurred during scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
  }
}

// scrapeSampledInSongs(artist, song, pageNumber)

// scrapeAllSongsSampledIn(artist, song)
const artist = "Coi Leray";
const song = "Players";

scrapeMainPage(artist, song);

// scrapeAllArtistSongs(artist);
