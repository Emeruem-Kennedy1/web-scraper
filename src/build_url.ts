import config from '../configs/configs.json';

const BASE_URL = config.BASE_URL;

/* 
take an artist name or song name and build the appropriate url. For example

 Aaron Paul Nelson -> https://www.whosampled.com/Aaron-Paul-Nelson/
 A.C.N. -> https://www.whosampled.com/A.C.N./ 
 100% (Taiwanese Band) -> https://www.whosampled.com/100%25-(Taiwanese-Band)/
 10° Below (Hip-Hop Group) -> https://www.whosampled.com/10%C2%B0-Below-(Hip-Hop-Group)/
 J. Cole -> https://www.whosampled.com/J.-Cole/
*/
function buildUrl(url: string, pageNumber:number=1): string {
    // replace all spaces with '-' and remove all special characters
    url = url.replace(/ /g, '-');

    // encode special characters
    url = encodeURIComponent(url);
    if (pageNumber > 1) {
        return `${config.BASE_URL}/${url}/?sp=${pageNumber}`;
    }
    return `${config.BASE_URL}/${url}/`;
}

function buildSongUrl(artist: string, song: string): string {
    artist = artist.replace(/ /g, '-');
    artist = encodeURIComponent(artist);
    song = song.replace(/ /g, '-');
    song = encodeURIComponent(song);
    return `${config.BASE_URL}/${artist}/${song}/`;
}

function buildSamplePageUrl(artist: string, song: string): string {
    artist = artist.replace(/ /g, '-');
    artist = encodeURIComponent(artist);
    song = song.replace(/ /g, '-');
    song = encodeURIComponent(song);
    return `${config.BASE_URL}/${artist}/${song}/sampled/`;
}

export { buildUrl, buildSongUrl, buildSamplePageUrl };