const async = require('async');
const cheerio = require('cheerio');
const Url = require('url-parse');
const fs = require('fs-extra');
const path = require('path');
const get = require('get');
const Datastore = require('nedb');
let Parser = require('rss-parser');
let parser = new Parser();
const {
  PATHS,
  PARALLEL_LIMIT,
  REDDIT_RSS_FEEDS,
  IMAGE_METADATA_DB,
} = require('../constants');

const db = new Datastore({ filename: IMAGE_METADATA_DB, autoload: true });

// ----------------------------- Init ---------------------------------------------- //

Object.values(PATHS).forEach(PATH => fs.mkdirp(PATH));

// ----------------------------- Main ----------------------------------------------- //

function delay(func, milliseconds) {
  return setTimeout(func, milliseconds);
}

let masterSmartList = [];

function download(smartLink, callback) {
  const { bucket, filename, filepath, href } = smartLink;
  console.log('  Downloading:', filename);

  if (fs.pathExistsSync(filepath)) {
    console.log('  -Skipping: File Exists.');
    callback();
    return;
  }

  get({ uri: href, }).toDisk(filepath, (err, filename) => {
    if (err) console.log('  Error saving', filePath, 'to disk:', err);
    else delay(callback, 1000);
  });
}

/* once we have the list of links (as objects with all the properties we need), download them */
function downloadAllImages(smartImgList) {
  return new Promise((resolve, reject) => {

    async.eachLimit(smartImgList, PARALLEL_LIMIT, download, (err) => {
      if (err) reject('error in async.eachLimit() of downloadAllImages():' + err);
      else resolve();
    });
  });
}

/* converts list from a array of strings (links) to a smart Url() object with filename info */
function convertImgListToSmartList(imgList, bucketName = 'CONTENT') {
  return new Promise((resolve, reject) => {
    const cleanImgList = imgList.filter(link => /\.\w{3}$/.test(link))
    const smartImgList = cleanImgList.map(link => {
      const url = new Url(link);
      url.bucket = bucketName,
      url.filename = url.pathname.split('/').slice(-1)[0];
      url.filepath = path.join(PATHS[bucketName], url.filename);
      return url;
    });

    resolve(smartImgList);
  })
}

/* downloads and scrapes from the rss feed. only supports reddit's rss due to selectors used */
function getImageListFromRedditRSS(rssLinks) {
  return new Promise((resolve, reject) => {
    const imageList = [];

    const parseLinksFromRedditRSS = (url, callback) => {
      try {
        parser.parseURL(url).then(feed => {
          feed.items.forEach(item => {
            const $ = cheerio.load(item.content);
            $('a').each((idx, itemEl) => {
              const innerText = $(itemEl).text();
              if (innerText !== '[link]') return;

              const href = itemEl.attribs.href;
              imageList.push(href);
              db.findOne({ href }, (err, doc) => {
                if (err) console.log('error findOne()', href);

                const parsedUrl = new Url(href);
                const filename = parsedUrl.pathname.split('/').slice(-1)[0];
                const { author } = item;
                const { title } = feed
                if (!filename) return;
                if (!doc) db.insert({ filename, author, title, href });
              });
            });
          });
  
          console.log('  -Fetched', url);
          delay(callback, 1000);
        });
      } catch (err) {
        console.log('  -Catch Thrown in parseLinksFromRedditRSS().', err);
        delay(callback, 1000);
      }
    };

    console.log('  Fetting all RSS feeds in bucket');
    async.eachLimit(rssLinks, PARALLEL_LIMIT, parseLinksFromRedditRSS, (err) => {
      if (err) reject('  -Error getting rss feeds: ' + err);
      else resolve(imageList);
    });
  });
}

/* A feed bucket is the type of feed. content, styles, ect. Keep them in seperate dl folders */
function downloadFeedBucket(bucket, key, callback) {
  const [bucketName, linkArr] = bucket;
  console.log('Downloading bucket of RSS feeds from bucket', bucketName);

  getImageListFromRedditRSS(linkArr)
    .then(imgList => convertImgListToSmartList(imgList, bucketName))
    .then(smartList => {
      masterSmartList = [ ...masterSmartList, ...smartList ];
      console.log('-Done with this bucket.');
      callback();
    })
    .catch(err => {
      console.log('-Err getting list from reddit rss', err);
      callback();
    });
}

console.log('Looking at all RSS buckets.');
async.eachOfSeries(Object.entries(REDDIT_RSS_FEEDS), downloadFeedBucket, (err) => {
  if (err) {
    console.log('error in async.eachOfSeries():', err);
    return;
  }
  
  downloadAllImages(masterSmartList)
    .then(() => console.log('All Complete!'))
});
