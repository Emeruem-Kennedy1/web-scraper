import { Page } from "puppeteer";

// Find out how many pages we need to navigate to for an artist (class pagination-wrapper)
// find the max value of the pagination-wrapper class

//  ! note that the first artist in mainArtists is the artist to use the base artist for the url to go to the song page

// songs are in class trackList bordered-list and then inside that the trackName class

async function getArtistContentOnPage(page: Page, url: string, start: boolean) {
  // Navigate to the specified URL
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for Cloudflare challenge to pass (adjust timeout as needed)
  await page.waitForFunction(
    () => {
      return !document.querySelector("div.cf-browser-verification");
    },
    { timeout: 30000 }
  );

  // Add a random delay to mimic human behavior
  await page.evaluate(() => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 1000) + 1000)
    );
  });

  // Wait for the track items to load
  // await page.waitForSelector(".trackItem", { timeout: 30000 });

  const artistContent = await page.evaluate(() => {
    const trackItems = document.querySelectorAll(".trackItem");
    return Array.from(trackItems).map((item) => {
      const trackName =
        item
          .querySelector('.trackName span[itemprop="name"]')
          ?.textContent?.trim() || "";
      const trackYear = item
        .querySelector(".trackYear")
        ?.textContent?.trim()
        .replace(/[()]/g, "");
      const artistNameSpan = item.querySelector(".trackArtistName");
      let mainArtists = [];
      let featuringArtists: string[] = [];
      let featSplit = artistNameSpan?.innerHTML?.split(" feat. ") || [];

      if (featSplit.length > 1) {
        mainArtists = featSplit[0]
          .split(" and ")
          .map((artist) => artist.replace(/<\/?[^>]+(>|$)/g, "").trim())
          .filter((artist) => artist !== "by" && artist !== "");
        featuringArtists = featSplit[1]
          .split(" and ")
          .map((artist) => artist.replace(/<\/?[^>]+(>|$)/g, "").trim());
      } else {
        mainArtists =
          artistNameSpan?.innerHTML
            ?.split(" and ")
            .map((artist) => artist.replace(/<\/?[^>]+(>|$)/g, "").trim())
            .filter((artist) => artist !== "by" && artist !== "") || [];
      }

      if (mainArtists.length > 0) {
        mainArtists[0] = mainArtists[0].replace(/^by\s+/, "");
      }

      return {
        trackName,
        trackYear,
        mainArtists,
        featuringArtists,
      };
    });
  });

  const lastPage = await page.evaluate(() => {
    const paginationWrapper = document.querySelector(".pagination-wrapper");
    if (!paginationWrapper) {
      return 1;
    }

    const pageElements = paginationWrapper.querySelectorAll(
      ".pagination .page a, .pagination .curr"
    );
    const pageNums = Array.from(pageElements)
      .map((el) => parseInt(el.textContent || "0"))
      .filter((num) => !isNaN(num));

    const lastPage = Math.max(...pageNums);
    return lastPage;
  });

  if (start) {
    return { artistContent, lastPage };
  }

  return artistContent;
}

async function getAllArtistContent(
  page: Page,
  baseUrl: string,
  artist: string
) {
  let allContent: any[] = [];
  let currentPage = 1;
  let lastPage: number = 1;

  do {
    const url = currentPage === 1 ? baseUrl : `${baseUrl}?sp=${currentPage}`;
    const result = await getArtistContentOnPage(page, url, currentPage === 1);

    let contentToAdd;
    if (currentPage === 1) {
      lastPage = (result as { artistContent: any[]; lastPage: number })
        .lastPage;
      contentToAdd = (result as { artistContent: any[]; lastPage: number })
        .artistContent;
    } else {
      contentToAdd = result as any[];
    }

    // Process each track to ensure main artist is set
    const processedContent = contentToAdd.map((track) => ({
      ...track,
      mainArtists:
        track.mainArtists.length === 0 ? [artist] : track.mainArtists,
    }));

    allContent = allContent.concat(processedContent);

    currentPage++;
  } while (currentPage <= lastPage);

  return allContent;
}

async function getSampledInContentOnPage(page: Page, url: string) {
  // Navigate to the specified URL
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for Cloudflare challenge to pass (adjust timeout as needed)
  await page.waitForFunction(
    () => {
      return !document.querySelector("div.cf-browser-verification");
    },
    { timeout: 30000 }
  );

  // Add a random delay to mimic human behavior
  await page.evaluate(() => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 3000) + 1000)
    );
  });

  // Wait for the track items to load
  // await page.waitForSelector('.table', { timeout: 30000 });

  const artistContent = await page.evaluate(() => {
    const rows = document.querySelectorAll("table.table.tdata tbody tr");
    return Array.from(rows).map((row) => {
      const songNameElement = row.querySelector(".tdata__td2 a.trackName");
      const artistNameElement = row.querySelector(".tdata__td3 a");
      const yearElement = row.querySelector(".tdata__td3:nth-child(4)");

      const songName = songNameElement?.textContent?.trim() ?? "";
      const artistName = artistNameElement?.textContent?.trim() ?? "";
      const year = yearElement ? yearElement?.textContent?.trim() : "";

      return { songName, artistName, year };
    });
  });

  return artistContent;
}

async function getAllSampledInContent(page: Page, baseUrl: string) {
  let allContent: any[] = [];
  let currentPage = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const url = currentPage === 1 ? baseUrl : `${baseUrl}?cp=${currentPage}`;

    // Navigate to the page
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for Cloudflare challenge to pass (adjust timeout as needed)
    await page.waitForFunction(
      () => {
        return !document.querySelector("div.cf-browser-verification");
      },
      { timeout: 30000 }
    );

    // Add a random delay to mimic human behavior
    await page.evaluate(() => {
      return new Promise((resolve) =>
        setTimeout(resolve, Math.floor(Math.random() * 3000) + 1000)
      );
    });

    const pageContent = await getSampledInContentOnPage(page, url);
    allContent = allContent.concat(pageContent);

    console.log(`Scraped page ${currentPage}`);

    // Check if there's a next page
    hasNextPage = await page.evaluate(() => {
      const nextButton = document.querySelector(".pagination .next a");
      return !!nextButton;
    });

    currentPage++;

    // Add a delay between requests to be polite to the server
    await new Promise((resolve) =>
      setTimeout(resolve, 2000 + Math.random() * 1000)
    );
  }

  return allContent;
}

async function scrapeSongDetailsPage(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for Cloudflare challenge to pass (adjust timeout as needed)
  await page.waitForFunction(
    () => {
      return !document.querySelector("div.cf-browser-verification");
    },
    { timeout: 30000 }
  );

  // Add a random delay to mimic human behavior
  await page.evaluate(() => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 3000) + 1000)
    );
  });

  const songDetails = await page.evaluate(() => {
    const getTextContent = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? element.textContent?.trim() : null;
    };

    const parseArtists = (artistCell: HTMLElement) => {
      const artistText = artistCell.innerHTML;
      let mainArtists: string[] = [];
      let featuringArtists: string[] = [];

      // Split by "feat." to separate main artists from featuring artists
      const parts = artistText.split(/\s+feat\.\s+/);

      // Process main artists
      if (parts[0]) {
        mainArtists = parts[0]
          .split(/\s+and\s+/)
          .map((artist) => {
            const match = artist.match(/<a[^>]*>([^<]+)<\/a>/);
            return match
              ? match[1].trim()
              : artist.replace(/<[^>]+>/g, "").trim();
          })
          .filter((artist) => artist && artist !== "and");
      }

      // Process featuring artists if they exist
      if (parts[1]) {
        featuringArtists = parts[1]
          .split(/\s+and\s+/)
          .map((artist) => {
            const match = artist.match(/<a[^>]*>([^<]+)<\/a>/);
            return match
              ? match[1].trim()
              : artist.replace(/<[^>]+>/g, "").trim();
          })
          .filter((artist) => artist && artist !== "and");
      }

      return { mainArtists, featuringArtists };
    };

    const mainGenre = getTextContent(".tooltip-genre");

    const scrapeSampleTable = (tableSelector: string) => {
      const rows = document.querySelectorAll(`${tableSelector} tbody tr`);
      return Array.from(rows).map((row) => {
        const artistCell = row.querySelector(".tdata__td3");
        const { mainArtists, featuringArtists } = parseArtists(
          artistCell as HTMLElement
        );

        return {
          songName:
            row.querySelector(".tdata__td2 a")?.textContent?.trim() || "",
          mainArtists,
          featuringArtists,
          year:
            row
              .querySelector(".tdata__td3:nth-child(4)")
              ?.textContent?.trim() || "",
          sampleType:
            row.querySelector(".tdata__badge")?.textContent?.trim() || "",
        };
      });
    };

    const containsSamples = scrapeSampleTable(
      '.subsection:has(.section-header-title:contains("Contains samples of")) .table.tdata'
    );
    const sampledIn = scrapeSampleTable(
      '.subsection:has(.section-header-title:contains("Sampled in")) .table.tdata'
    );

    const hasMoreSampledIn = !!document.querySelector(
      '.subsection:has(.section-header-title:contains("Sampled in")) .btn-wrapper a[href*="/sampled/"]'
    );

    return {
      mainGenre,
      containsSamples,
      sampledIn,
      hasMoreSampledIn,
    };
  });

  return songDetails;
}

async function scrapeSongDetails(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for Cloudflare challenge to pass (adjust timeout as needed)
  await page.waitForFunction(
    () => !document.querySelector("div.cf-browser-verification"),
    { timeout: 30000 }
  );

  const songDetails = await page.evaluate(() => {
    const getGenre = () => {
      const genreElement = document.querySelector(
        'a[href^="/genre/"] span[itemprop="genre"]'
      );
      if (genreElement) {
        const temp = document.createElement("div");
        temp.innerHTML = genreElement.innerHTML;
        return temp.textContent?.trim().split("/ ") || null;
      }
      return null;
    };

    const parseArtists = (artistCell: HTMLElement) => {
      const artistText = artistCell.innerHTML;
      let mainArtists: string[] = [];
      let featuringArtists: string[] = [];

      // Split by "feat." to separate main artists from featuring artists
      const parts = artistText.split(/\s+feat\.\s+/);

      // Process main artists
      if (parts[0]) {
        mainArtists = parts[0]
          .split(/\s+and\s+/)
          .map((artist) => {
            // Extract text from anchor tags or use plain text
            const match = artist.match(/<a[^>]*>([^<]+)<\/a>/);
            return match
              ? match[1].trim()
              : artist.replace(/<[^>]+>/g, "").trim();
          })
          .filter((artist) => artist && artist !== "and");
      }

      // Process featuring artists if they exist
      if (parts[1]) {
        featuringArtists = parts[1]
          .split(/\s+and\s+/)
          .map((artist) => {
            const match = artist.match(/<a[^>]*>([^<]+)<\/a>/);
            return match
              ? match[1].trim()
              : artist.replace(/<[^>]+>/g, "").trim();
          })
          .filter((artist) => artist && artist !== "and");
      }

      return { mainArtists, featuringArtists };
    };

    const scrapeSampleTable = (sectionTitle: string) => {
      const section = Array.from(document.querySelectorAll(".subsection")).find(
        (section) =>
          section
            .querySelector(".section-header-title")
            ?.textContent?.includes(sectionTitle)
      );

      if (!section) return { data: [], hasSeeAll: false };

      const rows = section.querySelectorAll(".table.tdata tbody tr");
      const data = Array.from(rows).map((row) => {
        const artistCell = row.querySelector(".tdata__td3");
        const { mainArtists, featuringArtists } = parseArtists(
          artistCell as HTMLElement
        );

        return {
          songName:
            row.querySelector(".tdata__td2 a")?.textContent?.trim() || "",
          mainArtists,
          featuringArtists,
          year:
            row
              .querySelector(".tdata__td3:nth-child(4)")
              ?.textContent?.trim() || "",
          sampleType:
            row.querySelector(".tdata__badge")?.textContent?.trim() || "",
        };
      });

      const seeAllButton = section.querySelector(".btn-wrapper a");
      const hasSeeAll =
        seeAllButton !== null &&
        seeAllButton.textContent?.trim().toLowerCase() === "see all";
      const seeAllUrl = hasSeeAll ? seeAllButton.getAttribute("href") : null;

      return { data, hasSeeAll, seeAllUrl };
    };

    return {
      mainGenre: getGenre(),
      containsSamples: scrapeSampleTable("Contains samples of"),
      sampledIn: scrapeSampleTable("Sampled in"),
    };
  });

  return songDetails;
}

async function scrapeAllPages(page: Page, url: string) {
  let allContent: {
    songName: string;
    mainArtists: string[];
    featuringArtists: string[];
    year: string;
    sampleType: string;
  }[] = [];
  let currentPage = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const pageUrl = currentPage === 1 ? url : `${url}?cp=${currentPage}`;
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });

    // Wait for Cloudflare challenge to pass
    await page.waitForFunction(
      () => !document.querySelector("div.cf-browser-verification"),
      { timeout: 30000 }
    );

    const pageContent = await page.evaluate(() => {
      const parseArtists = (artistCell: HTMLElement) => {
        const artistText = artistCell.innerHTML;
        let mainArtists: string[] = [];
        let featuringArtists: string[] = [];

        // Split by "feat." to separate main artists from featuring artists
        const parts = artistText.split(/\s+feat\.\s+/);

        // Process main artists
        if (parts[0]) {
          mainArtists = parts[0]
            .split(/\s+and\s+/)
            .map((artist) => {
              const match = artist.match(/<a[^>]*>([^<]+)<\/a>/);
              return match
                ? match[1].trim()
                : artist.replace(/<[^>]+>/g, "").trim();
            })
            .filter((artist) => artist && artist !== "and");
        }

        // Process featuring artists if they exist
        if (parts[1]) {
          featuringArtists = parts[1]
            .split(/\s+and\s+/)
            .map((artist) => {
              const match = artist.match(/<a[^>]*>([^<]+)<\/a>/);
              return match
                ? match[1].trim()
                : artist.replace(/<[^>]+>/g, "").trim();
            })
            .filter((artist) => artist && artist !== "and");
        }

        return { mainArtists, featuringArtists };
      };

      const rows = document.querySelectorAll("table.table.tdata tbody tr");
      return Array.from(rows).map((row) => {
        const artistCell = row.querySelector(".tdata__td3");
        const { mainArtists, featuringArtists } = parseArtists(
          artistCell as HTMLElement
        );

        return {
          songName:
            row.querySelector(".tdata__td2 a.trackName")?.textContent?.trim() ||
            "",
          mainArtists,
          featuringArtists,
          year:
            row
              .querySelector(".tdata__td3:nth-child(4)")
              ?.textContent?.trim() || "",
          sampleType:
            row.querySelector(".tdata__badge")?.textContent?.trim() || "",
        };
      });
    });

    allContent = allContent.concat(pageContent);

    hasNextPage = await page.evaluate(
      () => !!document.querySelector(".pagination .next a")
    );
    currentPage++;

    // Add a delay between requests
    await new Promise((resolve) =>
      setTimeout(resolve, 2000 + Math.random() * 1000)
    );
  }

  return allContent;
}

async function scrapeComprehensiveSongDetails(page: Page, baseUrl: string) {
  const songDetails = await scrapeSongDetails(page, baseUrl);

  if (songDetails.sampledIn.hasSeeAll && songDetails.sampledIn.seeAllUrl) {
    songDetails.sampledIn.data = await scrapeAllPages(
      page,
      new URL(songDetails.sampledIn.seeAllUrl, baseUrl).href
    );
  }
  if (
    songDetails.containsSamples.hasSeeAll &&
    songDetails.containsSamples.seeAllUrl
  ) {
    songDetails.containsSamples.data = await scrapeAllPages(
      page,
      new URL(songDetails.containsSamples.seeAllUrl, baseUrl).href
    );
  }

  return songDetails;
}

async function scrapeGenreOnly(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for Cloudflare challenge to pass
  await page.waitForFunction(
    () => !document.querySelector("div.cf-browser-verification"),
    { timeout: 30000 }
  );

  // Add a small random delay
  await page.evaluate(() => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 1000) + 500)
    );
  });

  const genreInfo = await page.evaluate(() => {
    const genreElement = document.querySelector(
      'a[href^="/genre/"] span[itemprop="genre"]'
    );
    if (genreElement) {
      // Create a temporary element to handle HTML entities
      const temp = document.createElement("div");
      temp.innerHTML = genreElement.innerHTML;
      return temp.textContent?.trim().split("/ ") || null;
    }
    return null;
  });

  return { mainGenre: genreInfo };
}

interface SongWithRelations {
  songName: string;
  mainArtists: string[];
  featuringArtists: string[];
  year: string;
  sampleType: string;
  url: string;
}

// Add these functions to your get_songs.ts file
async function getMaxSamplesCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const header = document.querySelector(".section-header-title");
    if (header) {
      const match = header.textContent?.match(/Sampled in (\d+) songs/);
      return match ? parseInt(match[1]) : 0;
    }
    return 0;
  });
}

async function getSampleUrlsWithLimit(
  page: Page,
  url: string,
  limit: number = 1000
): Promise<SongWithRelations[]> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.querySelector("div.cf-browser-verification"),
    { timeout: 30000 }
  );

  const totalSamples = await getMaxSamplesCount(page);
  const pagesToScrape = Math.min(
    Math.ceil(limit / 20),
    Math.ceil(totalSamples / 20)
  ); // 20 items per page

  let allSamples: SongWithRelations[] = [];

  for (let currentPage = 1; currentPage <= pagesToScrape; currentPage++) {
    const pageUrl = currentPage === 1 ? url : `${url}?cp=${currentPage}`;
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => !document.querySelector("div.cf-browser-verification"),
      { timeout: 30000 }
    );

    const pageSamples = await page.evaluate(() => {
      const rows = document.querySelectorAll("table.table.tdata tbody tr");
      return Array.from(rows).map((row) => {
        const songLink = row.querySelector(".tdata__td2 a.trackName");
        const url = songLink?.getAttribute("href") || "";

        return {
          songName: songLink?.textContent?.trim() || "",
          mainArtists: [], // We'll parse this later to reduce complexity
          featuringArtists: [],
          year:
            row
              .querySelector(".tdata__td3:nth-child(4)")
              ?.textContent?.trim() || "",
          sampleType:
            row.querySelector(".tdata__badge")?.textContent?.trim() || "",
          url: url,
        };
      });
    });

    allSamples = allSamples.concat(pageSamples);

    if (allSamples.length >= limit) {
      allSamples = allSamples.slice(0, limit);
      break;
    }

    // Add delay between pages
    await new Promise((resolve) =>
      setTimeout(resolve, 2000 + Math.random() * 1000)
    );
  }

  return allSamples;
}

export {
  getSampledInContentOnPage,
  getArtistContentOnPage,
  getAllArtistContent,
  scrapeSongDetailsPage,
  getAllSampledInContent,
  scrapeComprehensiveSongDetails,
  scrapeGenreOnly,
  getSampleUrlsWithLimit,
};
