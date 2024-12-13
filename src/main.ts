import { PrismaClient } from "@prisma/client";
import { Scrapper } from "./scrapper";
import { buildUrl, buildSongUrl, buildSamplePageUrl } from "./build_url";
import {
  getAllArtistContent,
  scrapeComprehensiveSongDetails,
  scrapeGenreOnly,
  getSampleUrlsWithLimit,
} from "./get_songs";
import * as winston from "winston";
import * as fs from "fs";
import * as path from "path";
import { Page } from "puppeteer";

const prisma = new PrismaClient();

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

interface SongData {
  trackName: string;
  trackYear: string | null;
  mainArtists: string[];
  featuringArtists: string[];
}

interface SampleData {
  songName: string;
  mainArtists: string[];
  featuringArtists: string[];
  year: string;
  sampleType: string;
}

async function processGenres(songId: number, genres: string[]) {
  for (const genreName of genres) {
    if (!genreName) continue; // Skip empty genres

    const genre = await prisma.genre.upsert({
      where: { name: genreName },
      create: { name: genreName },
      update: {},
    });

    await prisma.song.update({
      where: { id: songId },
      data: {
        genres: {
          connect: { id: genre.id },
        },
      },
    });
  }
}

async function getSongGenres(
  scrapperOrPage: Scrapper | Page,
  artistName: string,
  songName: string
): Promise<string[]> {
  const url = buildSongUrl(artistName, songName);

  // If it's a Page, use it directly, otherwise use the scrapper
  const details = isPage(scrapperOrPage)
    ? await scrapeGenreOnly(scrapperOrPage, url)
    : await scrapperOrPage.run(scrapeGenreOnly, [url]);

  // Handle null/undefined genres
  if (!details.mainGenre) {
    return [];
  }

  // If it's an array, filter out null/undefined values
  if (Array.isArray(details.mainGenre)) {
    return details.mainGenre.filter(
      (genre): genre is string => typeof genre === "string" && genre.length > 0
    );
  }

  // If it's a single genre, ensure it's a non-empty string
  return typeof details.mainGenre === "string" &&
    (details.mainGenre as string).length > 0
    ? [details.mainGenre]
    : [];
}

// Add a type guard to check if the argument is a Page
function isPage(arg: any): arg is Page {
  return arg && typeof arg === "object" && "goto" in arg;
}

async function processArtistSongs(scrapper: Scrapper, artistName: string) {
  logger.info(`Processing artist: ${artistName}`);

  // Create or get the artist
  const artist = await prisma.artist.upsert({
    where: { name: artistName },
    create: { name: artistName },
    update: {},
  });

  // Get all songs for the artist
  const url = buildUrl(artistName);
  const songs = await scrapper.run(getAllArtistContent, [url, artistName]);

  // Process songs sequentially to avoid database conflicts
  for (const songData of songs) {
    try {
      logger.info(
        `Processing song: ${songData.trackName} for artist: ${artistName}`
      );

      // ... rest of the function remains the same ...
    } catch (error) {
      logger.error(
        `Error processing song ${songData.trackName} for artist: ${artistName}:`,
        error
      );
      throw error; // Let the error propagate up
    }
  }
}

async function processSongDetails(
  scrapper: Scrapper,
  artistName: string,
  songName: string,
  songId: number,
  logger: winston.Logger
) {
  logger.info(
    `Starting to process details for song: ${songName} by ${artistName}`
  );

  try {
    // First get the main song's genres
    const mainSongGenres = await getSongGenres(scrapper, artistName, songName);
    if (mainSongGenres.length > 0) {
      await processGenres(songId, mainSongGenres);
      logger.info(`Processed genres for main song: ${songName}`);
    }

    // Get samples information
    const url = buildSongUrl(artistName, songName);
    const details = await scrapper.run(scrapeComprehensiveSongDetails, [url]);
    logger.info(`Got samples information for song: ${songName}`);

    // Process samples
    const processSampleData = async (
      sampleData: SampleData[],
      isSampledIn: boolean
    ) => {
      logger.info(
        `Processing ${sampleData.length} ${
          isSampledIn ? "sampled in" : "samples used"
        } for ${songName}`
      );

      for (const sample of sampleData) {
        try {
          // Create the sampled song first
          const sampledSong = await prisma.song.create({
            data: {
              title: sample.songName,
              releaseYear: sample.year ? parseInt(sample.year) : null,
            },
          });
          logger.info(`Created sample song: ${sample.songName}`);

          // Process main artists
          for (const mainArtistName of sample.mainArtists) {
            const mainArtist = await prisma.artist.upsert({
              where: { name: mainArtistName },
              create: { name: mainArtistName },
              update: {},
            });

            try {
              await prisma.songArtist.create({
                data: {
                  songId: sampledSong.id,
                  artistId: mainArtist.id,
                  isMainArtist: true,
                },
              });
            } catch (error) {
              if (
                !(
                  error instanceof Error &&
                  error.message.includes("Unique constraint")
                )
              ) {
                throw error;
              }
            }
          }

          // Process featuring artists
          for (const featArtistName of sample.featuringArtists) {
            const featArtist = await prisma.artist.upsert({
              where: { name: featArtistName },
              create: { name: featArtistName },
              update: {},
            });

            try {
              await prisma.songArtist.create({
                data: {
                  songId: sampledSong.id,
                  artistId: featArtist.id,
                  isMainArtist: false,
                },
              });
            } catch (error) {
              if (
                !(
                  error instanceof Error &&
                  error.message.includes("Unique constraint")
                )
              ) {
                throw error;
              }
            }
          }

          // Get and process genres for the sampled song using getSongGenres
          try {
            const sampleGenres = await getSongGenres(
              scrapper,
              sample.mainArtists[0],
              sample.songName
            );
            if (sampleGenres.length > 0) {
              await processGenres(sampledSong.id, sampleGenres);
              logger.info(
                `Processed genres for sampled song: ${sample.songName}`
              );
            }
          } catch (error) {
            logger.error(
              `Error getting genres for sampled song ${sample.songName}:`,
              error
            );
          }

          // Create the sample relationship
          try {
            await prisma.sample.create({
              data: {
                originalSongId: isSampledIn ? songId : sampledSong.id,
                sampledInSongId: isSampledIn ? sampledSong.id : songId,
              },
            });
            logger.info(`Created sample relationship for: ${sample.songName}`);
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                error.message.includes("Unique constraint")
              )
            ) {
              throw error;
            }
          }
        } catch (error) {
          logger.error(`Error processing sample ${sample.songName}:`, error);
        }
      }
    };

    // Process contained samples
    if (details.containsSamples?.data) {
      await processSampleData(details.containsSamples.data, false);
    }

    // Process sampled in
    if (details.sampledIn?.data) {
      await processSampleData(details.sampledIn.data, true);
    }

    logger.info(`Completed processing details for song: ${songName}`);
  } catch (error) {
    logger.error(`Error in processSongDetails for ${songName}:`, error);
    throw error;
  }
}

async function processSongDetailsConcurrent(
  scrapper: Scrapper,
  artistName: string,
  songName: string,
  songId: number,
  logger: winston.Logger,
  sampleLimit: number = 500
) {
  logger.info(
    `Starting to process details for song: ${songName} by ${artistName}`
  );

  // Setup progress tracking
  const progressFile = path.join(
    process.cwd(),
    "progress",
    `progress_${artistName.replace(/[^a-z0-9]/gi, "_")}_${songName.replace(
      /[^a-z0-9]/gi,
      "_"
    )}.json`
  );
  let processedSamples: string[] = [];

  // Create progress directory if it doesn't exist
  const progressDir = path.dirname(progressFile);
  if (!fs.existsSync(progressDir)) {
    fs.mkdirSync(progressDir, { recursive: true });
  }

  // Load existing progress if any
  if (fs.existsSync(progressFile)) {
    try {
      processedSamples = JSON.parse(fs.readFileSync(progressFile, "utf-8"));
      logger.info(
        `Loaded ${processedSamples.length} previously processed samples for ${songName}`
      );
    } catch (error) {
      logger.error(`Error loading progress file for ${songName}:`, error);
    }
  }

  try {
    // Run initial operations concurrently
    const url = buildSongUrl(artistName, songName);
    const [mainSongGenres, details] = await Promise.all([
      getSongGenres(scrapper, artistName, songName),
      scrapper.run(scrapeComprehensiveSongDetails, [url]),
    ]);

    if (mainSongGenres.length > 0) {
      await processGenres(songId, mainSongGenres);
      logger.info(`Processed genres for main song: ${songName}`);
    }

    // Prepare samples
    const allSamples: Array<{ sample: SampleData; isSampledIn: boolean }> = [
      ...(
        details.containsSamples?.data.slice(0, Math.floor(sampleLimit / 2)) ||
        []
      ).map((sample) => ({ sample, isSampledIn: false })),
      ...(
        details.sampledIn?.data.slice(0, Math.floor(sampleLimit / 2)) || []
      ).map((sample) => ({ sample, isSampledIn: true })),
    ];

    const samplesToProcess = allSamples.filter(
      ({ sample }) => !processedSamples.includes(sample.songName)
    );

    logger.info(
      `Found ${samplesToProcess.length} total new samples to process for ${songName}`
    );

    // Process in smaller chunks with direct page handling
    const chunkSize = 5;
    for (let i = 0; i < samplesToProcess.length; i += chunkSize) {
      const chunk = samplesToProcess.slice(i, i + chunkSize);
      logger.info(
        `Starting chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(
          samplesToProcess.length / chunkSize
        )}`
      );

      try {
        // Process each sample in chunk sequentially but with concurrent operations within each sample
        for (const { sample, isSampledIn } of chunk) {
          try {
            logger.info(`Processing sample: ${sample.songName}`);

            // First create the song record
            const sampledSong = await prisma.song.create({
              data: {
                title: sample.songName,
                releaseYear: sample.year ? parseInt(sample.year) : null,
              },
            });
            logger.info(`Created song record for: ${sample.songName}`);

            // Process genres
            const genres = await scrapper.run(getSongGenres, [
              sample.mainArtists[0],
              sample.songName,
            ]);

            if (genres.length > 0) {
              await processGenres(sampledSong.id, genres);
              logger.info(`Processed genres for: ${sample.songName}`);
            }

            // Process artists concurrently
            await Promise.all([
              // Handle main artists
              ...sample.mainArtists.map((mainArtistName) =>
                prisma.artist
                  .upsert({
                    where: { name: mainArtistName },
                    create: { name: mainArtistName },
                    update: {},
                  })
                  .then((artist) =>
                    prisma.songArtist
                      .create({
                        data: {
                          songId: sampledSong.id,
                          artistId: artist.id,
                          isMainArtist: true,
                        },
                      })
                      .catch((error) => {
                        if (
                          !(
                            error instanceof Error &&
                            error.message.includes("Unique constraint")
                          )
                        ) {
                          throw error;
                        }
                      })
                  )
              ),
              // Handle featuring artists
              ...sample.featuringArtists.map((featArtistName) =>
                prisma.artist
                  .upsert({
                    where: { name: featArtistName },
                    create: { name: featArtistName },
                    update: {},
                  })
                  .then((artist) =>
                    prisma.songArtist
                      .create({
                        data: {
                          songId: sampledSong.id,
                          artistId: artist.id,
                          isMainArtist: false,
                        },
                      })
                      .catch((error) => {
                        if (
                          !(
                            error instanceof Error &&
                            error.message.includes("Unique constraint")
                          )
                        ) {
                          throw error;
                        }
                      })
                  )
              ),
            ]);
            logger.info(`Processed artists for: ${sample.songName}`);

            // Create sample relationship
            await prisma.sample.create({
              data: {
                originalSongId: isSampledIn ? songId : sampledSong.id,
                sampledInSongId: isSampledIn ? sampledSong.id : songId,
              },
            });
            logger.info(`Created sample relationship for: ${sample.songName}`);

            // Mark as processed
            processedSamples.push(sample.songName);
            fs.writeFileSync(progressFile, JSON.stringify(processedSamples));

            logger.info(
              `Successfully completed processing: ${sample.songName}`
            );
          } catch (error) {
            logger.error(`Error processing sample ${sample.songName}:`, error);
          }

          // Add a small delay between samples within a chunk
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        logger.info(
          `Completed chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(
            samplesToProcess.length / chunkSize
          )}`
        );

        // Add delay between chunks
        if (i + chunkSize < samplesToProcess.length) {
          logger.info("Waiting between chunks...");
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (error) {
        logger.error(
          `Error processing chunk ${Math.floor(i / chunkSize) + 1}:`,
          error
        );
      }
    }

    logger.info(`Completed processing all details for song: ${songName}`);
  } catch (error) {
    logger.error(`Error in processSongDetails for ${songName}:`, error);
    throw error;
  }
}

interface ProcessingStatus {
  completed: string[];
  failed: { artist: string; error: string }[];
  lastUpdated: string;
}

class ArtistProgressTracker {
  private statusFilePath: string;
  private status: ProcessingStatus;

  constructor(outputDir: string) {
    this.statusFilePath = path.join(outputDir, "processing_status.json");
    this.status = this.loadStatus();
  }

  private loadStatus(): ProcessingStatus {
    try {
      if (fs.existsSync(this.statusFilePath)) {
        const content = fs.readFileSync(this.statusFilePath, "utf-8");
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn("Could not load existing status file, starting fresh.");
    }

    return {
      completed: [],
      failed: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private saveStatus(): void {
    this.status.lastUpdated = new Date().toISOString();
    fs.writeFileSync(
      this.statusFilePath,
      JSON.stringify(this.status, null, 2),
      "utf-8"
    );
  }

  markAsCompleted(artist: string): void {
    if (!this.status.completed.includes(artist)) {
      this.status.completed.push(artist);
      this.saveStatus();
    }
  }

  markAsFailed(artist: string, error: any): void {
    this.status.failed.push({
      artist,
      error: error.message || String(error),
    });
    this.saveStatus();
  }

  isCompleted(artist: string): boolean {
    return this.status.completed.includes(artist);
  }

  getCompletedArtists(): string[] {
    return this.status.completed;
  }

  getFailedArtists(): { artist: string; error: string }[] {
    return this.status.failed;
  }

  getRemainingArtists(allArtists: string[]): string[] {
    return allArtists.filter((artist) => !this.isCompleted(artist));
  }

  getProgressSummary(): string {
    return `
Progress Summary:
----------------
Completed: ${this.status.completed.length} artists
Failed: ${this.status.failed.length} artists
Last Updated: ${this.status.lastUpdated}
    `.trim();
  }
}

interface ArtistSongProgress {
  completedSongs: string[];
  lastUpdated: string;
  totalSongs?: number;
}

interface ArtistSongTracker {
  [artistName: string]: ArtistSongProgress;
}

class ArtistSongProgressTracker {
  private progressDir: string;
  private progressFile: string;
  private progress: ArtistSongTracker;

  constructor() {
    this.progressDir = path.join(process.cwd(), "artist_progress");
    this.progressFile = path.join(
      this.progressDir,
      "artist_songs_progress.json"
    );
    this.progress = this.loadProgress();
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.progressDir)) {
      fs.mkdirSync(this.progressDir, { recursive: true });
    }
  }

  private loadProgress(): ArtistSongTracker {
    try {
      if (fs.existsSync(this.progressFile)) {
        const content = fs.readFileSync(this.progressFile, "utf-8");
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(
        "Could not load existing artist songs progress file, starting fresh."
      );
    }
    return {};
  }

  private saveProgress(): void {
    fs.writeFileSync(
      this.progressFile,
      JSON.stringify(this.progress, null, 2),
      "utf-8"
    );
  }

  public markSongAsCompleted(
    artistName: string,
    songName: string,
    totalSongs?: number
  ): void {
    if (!this.progress[artistName]) {
      this.progress[artistName] = {
        completedSongs: [],
        lastUpdated: new Date().toISOString(),
        totalSongs,
      };
    }

    if (!this.progress[artistName].completedSongs.includes(songName)) {
      this.progress[artistName].completedSongs.push(songName);
      this.progress[artistName].lastUpdated = new Date().toISOString();
      if (totalSongs) {
        this.progress[artistName].totalSongs = totalSongs;
      }
      this.saveProgress();
    }
  }

  public isArtistCompleted(artistName: string, totalSongs: number): boolean {
    const artistProgress = this.progress[artistName];
    if (!artistProgress) return false;

    // If we have processed all songs for this artist
    return artistProgress.completedSongs.length === totalSongs;
  }

  public getCompletedSongs(artistName: string): string[] {
    return this.progress[artistName]?.completedSongs || [];
  }

  public getRemainingArtistSongs(
    artistName: string,
    currentSongs: string[]
  ): string[] {
    const completedSongs = this.getCompletedSongs(artistName);
    return currentSongs.filter((song) => !completedSongs.includes(song));
  }

  public getArtistProgress(artistName: string): ArtistSongProgress | null {
    return this.progress[artistName] || null;
  }

  public getProgressSummary(artistName: string): string {
    const progress = this.progress[artistName];
    if (!progress) return `No progress recorded for ${artistName}`;

    return `
Progress for ${artistName}:
--------------------------
Completed Songs: ${progress.completedSongs.length}
Total Songs: ${progress.totalSongs || "Unknown"}
Last Updated: ${progress.lastUpdated}
    `.trim();
  }
}

const artistSongTracker = new ArtistSongProgressTracker();

async function processArtistList(artists: string[]) {
  const progressTracker = new ArtistProgressTracker(path.join(__dirname, ".."));
  const remainingArtists = progressTracker.getRemainingArtists(artists);

  console.log(`
Total artists: ${artists.length}
Already completed: ${progressTracker.getCompletedArtists().length}
Remaining to process: ${remainingArtists.length}
  `);

  if (remainingArtists.length === 0) {
    console.log("All artists have been processed!");
    return;
  }

  // Single scrapper instance with just one page
  const scrapper = new Scrapper(4, 30); // 1 page, 30 requests per minute

  try {
    await scrapper.openBrowser();

    for (const artist of remainingArtists) {
      try {
        console.log(`\nStarting to process artist: ${artist}`);
        logger.info(`Starting to process artist: ${artist}`);

        // Create or get the artist
        const artistEntity = await prisma.artist.upsert({
          where: { name: artist },
          create: { name: artist },
          update: {},
        });

        // Get all songs for the artist
        const url = buildUrl(artist);
        const songs = await scrapper.run(getAllArtistContent, [url, artist]);
        console.log(`Found ${songs.length} songs for ${artist}`);
        logger.info(`Found ${songs.length} songs for artist: ${artist}`);

        // Get remaining songs to process
        const remainingSongs = artistSongTracker.getRemainingArtistSongs(
          artist,
          songs.map((song) => song.trackName)
        );

        if (remainingSongs.length === 0) {
          console.log(`All songs already processed for ${artist}`);
          progressTracker.markAsCompleted(artist);
          continue;
        }

        console.log(
          `Processing ${remainingSongs.length} remaining songs for ${artist}`
        );

        // Filter songs to only process remaining ones
        const songsToProcess = songs.filter((song) =>
          remainingSongs.includes(song.trackName)
        );

        // Process each song
        for (const songData of songs) {
          try {
            console.log(`\nProcessing song: ${songData.trackName}`);
            logger.info(
              `Processing song: ${songData.trackName} for artist: ${artist}`
            );
            if (
              artistSongTracker
                .getCompletedSongs(artist)
                .includes(songData.trackName)
            ) {
              logger.info(
                `Skipping already processed song: ${songData.trackName}`
              );
              continue;
            }

            // Create the song
            const song = await prisma.song.create({
              data: {
                title: songData.trackName,
                releaseYear: songData.trackYear
                  ? parseInt(songData.trackYear)
                  : null,
              },
            });

            // Process main artists
            for (const mainArtistName of songData.mainArtists) {
              const mainArtist = await prisma.artist.upsert({
                where: { name: mainArtistName },
                create: { name: mainArtistName },
                update: {},
              });

              try {
                await prisma.songArtist.create({
                  data: {
                    songId: song.id,
                    artistId: mainArtist.id,
                    isMainArtist: true,
                  },
                });
              } catch (error) {
                if (
                  !(
                    error instanceof Error &&
                    error.message.includes("Unique constraint")
                  )
                ) {
                  throw error;
                }
              }
            }

            // Process featuring artists
            for (const featArtistName of songData.featuringArtists) {
              const featArtist = await prisma.artist.upsert({
                where: { name: featArtistName },
                create: { name: featArtistName },
                update: {},
              });

              try {
                await prisma.songArtist.create({
                  data: {
                    songId: song.id,
                    artistId: featArtist.id,
                    isMainArtist: false,
                  },
                });
              } catch (error) {
                if (
                  !(
                    error instanceof Error &&
                    error.message.includes("Unique constraint")
                  )
                ) {
                  throw error;
                }
              }
            }

            // Process song details (samples and genres)
            console.log(`Getting details for song: ${songData.trackName}`);
            try {
              await processSongDetailsConcurrent(
                scrapper,
                songData.mainArtists[0],
                songData.trackName,
                song.id,
                logger
              );
              console.log(
                `Completed processing song details: ${songData.trackName}`
              );
            } catch (error) {
              logger.error(
                `Error processing song details for ${songData.trackName}:`,
                error
              );
              console.error(
                `Error processing song details for ${songData.trackName}:`,
                error
              );
            }
            artistSongTracker.markSongAsCompleted(
              artist,
              songData.trackName,
              songs.length
            );
            console.log(artistSongTracker.getProgressSummary(artist));
          } catch (error) {
            logger.error(`Error processing song ${songData.trackName}:`, error);
            console.error(
              `Error processing song ${songData.trackName}:`,
              error
            );
          }
        }

        // Mark artist as completed after all songs are processed
        progressTracker.markAsCompleted(artist);
        console.log(`\nCompleted processing artist: ${artist}`);
        logger.info(`Completed processing artist: ${artist}`);

        // Show progress
        console.log("\n" + progressTracker.getProgressSummary());

        // Optional: Add a small delay between artists
        if (remainingArtists.indexOf(artist) < remainingArtists.length - 1) {
          const delayTime = 500; // 5 seconds
          console.log(
            `\nWaiting ${delayTime / 1000} seconds before next artist...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayTime));
        }
      } catch (error) {
        logger.error(`Error processing artist ${artist}:`, error);
        console.error(`Error processing artist ${artist}:`, error);
        progressTracker.markAsFailed(artist, error);
      }
    }
  } finally {
    await scrapper.closeBrowser();
    await prisma.$disconnect();

    // Print final summary
    console.log("\nFinal " + progressTracker.getProgressSummary());
    if (progressTracker.getFailedArtists().length > 0) {
      console.log("\nFailed Artists:");
      progressTracker.getFailedArtists().forEach(({ artist, error }) => {
        console.log(`- ${artist}: ${error}`);
      });
    }
  }
}

// Usage remains the same
const filePath = path.join(__dirname, "..", "artists.txt");

try {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const artists = fileContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const uniqueArtists = ["Coi Leray", ...new Set(artists)];
  console.log(`Total unique artists to process: ${uniqueArtists.length}`);

  processArtistList(uniqueArtists).catch((error) => {
    console.error("Fatal error in main process:", error);
    process.exit(1);
  });
} catch (error) {
  console.error("Error reading the artists file:", error);
  process.exit(1);
}
