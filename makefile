build_and_run:
	@tsc && node lib/index.js

run_artist_page_scrape:
	@tsc && node lib/scrapeall.js

run_main_scrape:
	@tsc && node lib/main.js