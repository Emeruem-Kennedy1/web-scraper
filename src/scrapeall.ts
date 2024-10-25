import { PrismaClient } from "@prisma/client";
import { Scrapper } from "./scrapper";
import { getAllArtistContent } from "./get_songs";
import { buildUrl } from "./build_url";
import * as winston from "winston";
import { log } from "console";

const prisma = new PrismaClient(
  {
    log: [
      'warn', 'error'
    ],
  }
);

// Setup logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "artist-scraper.log" }),
    new winston.transports.Console(),
  ],
});

async function scrapeArtistPages(batchSize: number = 100, startId: number = 1) {
  const scrapper = new Scrapper(10, 100); // 5 concurrent pages, 60 requests per minute
  await scrapper.openBrowser();

  try {
    let currentId = startId;
    let hasMoreArtists = true;

    while (hasMoreArtists) {
      // Fetch a batch of artists from the database
      const artists = await prisma.artist.findMany({
        where: {
          id: {
            gte: currentId,
          },
        },
        orderBy: {
          id: "asc",
        },
        take: batchSize,
      });

      if (artists.length === 0) {
        hasMoreArtists = false;
        break;
      }

      const tasks = artists.map((artist) => ({
        func: getAllArtistContent,
        args: [buildUrl(artist.name), artist],
      }));

      const results = await scrapper.runConcurrent(tasks);

      // Process results
      for (let i = 0; i < results.length; i++) {
        const artist = artists[i];
        const result = results[i];

        if ("error" in result) {
          logger.error(`Error scraping artist ${artist.name}: ${result.error}`);
        } else {
          // Process and save the artist's content
          await saveArtistContent(artist.id, result);
          logger.info(`Finished scraping artist: ${artist.name}, ID: ${artist.id}`);
        }
      }

      currentId = artists[artists.length - 1].id + 1;
      logger.info(`Completed batch. Next artist ID: ${currentId}`);
    }

    logger.info("Artist scraping completed successfully");
  } catch (error) {
    logger.error("An error occurred during artist scraping:", error);
    throw error;
  } finally {
    await scrapper.closeBrowser();
    await prisma.$disconnect();
  }
}

async function saveArtistContent(artistId: number, content: any[]) {
  // Process each song in the content
  for (const song of content) {
    try {
      // First, create or find the song
      let existingSong = await prisma.song.findFirst({
        where: {
          title: song.trackName,
          artists: {
            some: {
              artistId: artistId,
              isMainArtist: true,
            },
          },
        },
        include: {
          artists: true,
        },
      });

      if (!existingSong) {
        // Create new song - REMOVED const declaration here
        existingSong = await prisma.song.create({
          data: {
            title: song.trackName,
            releaseYear: parseInt(song.trackYear) || null,
            artists: {
              create: [], // Initialize with an empty array or add relevant artist data here
            },
          },
          include: {
            artists: true, // Ensure the artists property is included
          },
        });

        // Process main artists
        for (const mainArtistName of song.mainArtists) {
          if (typeof mainArtistName === "string") {
            // Handle comma-separated artists
            const artists = mainArtistName.split(", ");

            for (const name of artists) {
              if (!name.trim()) continue;

              try {
                const mainArtist = await prisma.artist.upsert({
                  where: {
                    name: name.trim(),
                  },
                  update: {},
                  create: {
                    name: name.trim(),
                  },
                });

                await prisma.songArtist.create({
                  data: {
                    songId: existingSong.id,
                    artistId: mainArtist.id,
                    isMainArtist: true,
                  },
                });
              } catch (error) {
                logger.error(`Error processing main artist "${name}":`, error);
                continue;
              }
            }
          } else if (
            typeof mainArtistName === "object" &&
            mainArtistName !== null
          ) {
            const artistName = mainArtistName.name || String(mainArtistName);
            if (!artistName.trim()) continue;

            try {
              const mainArtist = await prisma.artist.upsert({
                where: {
                  name: artistName.trim(),
                },
                update: {},
                create: {
                  name: artistName.trim(),
                },
              });

              await prisma.songArtist.create({
                data: {
                  songId: existingSong.id,
                  artistId: mainArtist.id,
                  isMainArtist: true,
                },
              });
            } catch (error) {
              logger.error(
                `Error processing main artist "${artistName}":`,
                error
              );
              continue;
            }
          }
        }
      } else {
        // Update existing song if needed
        await prisma.song.update({
          where: { id: existingSong.id },
          data: { releaseYear: parseInt(song.trackYear) || null },
        });
      }

      // Process featuring artists
      for (const featuringArtistName of song.featuringArtists) {
        if (
          typeof featuringArtistName !== "string" ||
          !featuringArtistName.trim()
        )
          continue;

        try {
          const featuresArtists = featuringArtistName.split(", ");

          for (const featureArtist of featuresArtists) {
            if (!featureArtist.trim()) continue;

            try {
              const featuredArtist = await prisma.artist.upsert({
                where: {
                  name: featureArtist.trim(),
                },
                update: {},
                create: {
                  name: featureArtist.trim(),
                },
              });

              // Check if the featuring relationship already exists
              const existingFeature = await prisma.songArtist.findFirst({
                where: {
                  songId: existingSong.id,
                  artistId: featuredArtist.id,
                  isMainArtist: false,
                },
              });

              if (!existingFeature) {
                await prisma.songArtist.create({
                  data: {
                    songId: existingSong.id,
                    artistId: featuredArtist.id,
                    isMainArtist: false,
                  },
                });
              }
            } catch (error) {
              logger.error(
                `Error processing featuring artist "${featureArtist}":`,
                error
              );
              continue;
            }
          }
        } catch (error) {
          logger.error(
            `Error processing featuring artist "${featuringArtistName}":`,
            error
          );
          continue;
        }
      }
    } catch (error) {
      logger.error(
        `Error saving song ${song.trackName} for artist ${artistId}: ${error}`
      );
      throw error;
    }
  }
}

scrapeArtistPages(100, 1103).catch((error) => {
  logger.error("An error occurred during artist scraping:", error);
  process.exit(1);
});
