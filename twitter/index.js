require('dotenv').config();
const async = require('async');
const fs = require('fs-extra');
const path = require('path');
const { extendFileInfo } = require('../process/directory');
const Datastore = require('nedb');
const appender = require('../appender');
const Twit = require('twit');
const {
  PATHS,
  IMAGE_METADATA_DB,
  TWEETED_OUT_PATH,
} = require('../constants');

const db = new Datastore({ filename: IMAGE_METADATA_DB, autoload: true });

var twitter = new Twit({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
});

const hashtags = [
  'neuralnetworks',
  'deeplearning',
  'art',
  'MachineLearning',
  'ai',
  'gan',
  'tensorflow',
  'neuralstyletransfer',
  'mixedmedia',
  'drawing',
  'sketch',
  'abstract',
  'painting',
  'style',
  'digitalart',
  'artstyle',
  'python',
  'javascript',
  'js',
  'generated',
  'programmatic',
  'procedural',
  'artificial',
  'beauty',
];

// ----------------------------- Init ---------------------------------------------- //

fs.mkdirpSync(TWEETED_OUT_PATH);  
fs.mkdirpSync(PATHS.OUT2);  
fs.mkdirpSync(PATHS.FAILED);  

// -------------------------------------------------------------------------- //

function moveFile(filename) {
  const from = path.join(PATHS.OUT, filename);
  const to = path.join(TWEETED_OUT_PATH, filename);

  return fs.move(from, to); // is a promise
}

function tweet(status, mediaIds) {
  return new Promise((resolve, reject) => {
    console.log('Posting tweet...')
    twitter.post('statuses/update', { media_ids: mediaIds, status }, (err, data, response) => {
      if (err){
        reject('Error posting tweet:', err);
        return;
      }

      console.log('Posted tweet!');
      resolve();
    });
  });
}

function mediaUpload(buffer) {
  return new Promise((resolve, reject) => {
    console.log('Uploading image...', buffer.toString('base64').length)
    twitter.post('media/upload', { media_data: buffer.toString('base64') }, (err, data, response) => {
      if (err){
        reject('Error uploading image to Twitter:', err);
        return;
      }
      
      console.log('Image uploaded!');
      console.log('Now tweeting it...');
      const mediaIds = new Array(data.media_id_string);
      resolve(mediaIds);
    });
  });
}

function getOutDirectory() {
  return extendFileInfo(PATHS.OUT)
    .filter(file => /\.\w{3}$/.test(file.filename))
    .filter(file => file.size > 6144)
    .map(file => {
      const { filename, birthtimeMs } = file;
      const [ content, style, width, iterations ] = file.filename
        .match(/c\((.+?)\)_s\((.+?)\)_w(.+?)_i(.+?)\./)
        .slice(1);

      return { filename, content, style, width, iterations, birthtimeMs };
    });
}

function readFileFromDisk(filepath) {
  return new Promise((resolve, reject) => {
    console.log('about to read file from disk', filepath);
    fs.readFile(filepath, (err, buffer) => {
      if (err) reject('fs.readFile() error: ' + err);
      else resolve(buffer);
    });
  });
}

// -------------------------------------------------------------------------- //

function prepareImage(filename) {
  return new Promise((resolve, reject) => {
    appender(filename)
      .then(readFileFromDisk)
      .then(resolve)
      .catch(reject)
  });
}

function composeTweetText(metadata = {}, file = {}) {
  const { width, iterations } = file;
  const content = metadata.content || {};
  const style = metadata.style || {};
  let newHashtags = [...hashtags];
  let text = '';

  text += 'Randomly Art generated';
  if (content.author || style.author) text += ' from ';
  if (content.author) text += content.author;
  if (content.author && style.author) text += ' and ';
  if (style.author) text += style.author;
  text += '\n\n';

  text = text + '#' + newHashtags.splice(Math.random()*newHashtags.length ,1) + ' ';
  text = text + '#' + newHashtags.splice(Math.random()*newHashtags.length ,1) + '\n\n';
  
  text += 'Sources\n';
  if (content.href) text += `  ${content.href}`;
  if (style.href) text += `  ${style.href}`;
  text += '\n\n';

  // subreddit names
  if (content.title) text += `${content.title}\n`;
  if (style.title) text += `${style.title}`;

  return text.slice(0, 280);
}

function getMetadata(nextFile) {
  return new Promise((resolve, reject) => {
    const results = {
      content: {},
      style: {},
    };
  
    const lookup = (item, callback) => {
      db.findOne({ filename: nextFile[item] }, (err, doc) => { // item is either content or style.
        if (err) {
          callback('db.findOne() err: ' + err);
          return;
        }
        results[item] = doc;
        callback();
      });
    };
    
    async.each(Object.keys(results), lookup, err => {
      if (err) reject('error in async.each(): ' +  err);
      else resolve(results);
    });
  })
}

function main() {
  const outDirectory = getOutDirectory();
  const nextFile = outDirectory.slice(0,1)[0];

  const preflight = [
    prepareImage(nextFile.filename),
    getMetadata(nextFile),
  ];

  Promise.all(preflight).then(([buffer, metadata]) => {
    console.log('preflight done')
    const tweetTxt = composeTweetText(metadata, nextFile);
    console.log('tweet text prepared')

    console.log('done', buffer, metadata);


    mediaUpload(buffer) // upload img first
      .then(mediaIds => tweet(tweetTxt, mediaIds)) // here is the actual tweeting
      .then(() => moveFile(nextFile.filename)); // move file
  }).catch(error => console.log('Promises.all() error:', error));
}

main();
