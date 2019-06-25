const child_process = require('child_process');
let spawn = require('child_process').spawn;
const fs = require('fs');
const path = require('path');

const AWS = require('aws-sdk');
const request = require('request');
const tempy = require('tempy');

const s3 = new AWS.S3();

exports.handler = async function(event, context, callback) {
    // Object key may have spaces or unicode non-ASCII characters.
    let srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    let srcBucket = event.Records[0].s3.bucket.name;
    let srcRegion = event.Records[0].awsRegion;
    let srcFullpath = 'https://' + srcBucket + '.s3-' + srcRegion + '.amazonaws.com/' + srcKey;
    let dstBucket = process.env.S3_BUCKET_OUTPUT;
    let dstKey = 'preprocessing_' + srcKey;

    // Create temporary input/output filenames that we can clean up afterwards.
    const inputFilenameTmp = tempy.file();
    const mp4Filename = tempy.file({ extension: 'mp4' });

    // Download the source file.
    await downloadSourceFile(srcFullpath, inputFilenameTmp);

    // Use the Exodus ffmpeg bundled executable.
    const ffmpeg = await path.resolve(__dirname, 'exodus', 'bin', 'ffmpeg');

    // Compress & transcode video using ffmpeg.
    const ffmpegArgs = [
      '-i', inputFilenameTmp,
      '-vn', // Disable the video stream in the output.
      '-acodec', 'libmp3lame', // Use Lame for the mp3 encoding.
      '-ac', '2', // Set 2 audio channels.
      '-q:a', '6', // Set the quality to be roughly 128 kb/s.
        mp4Filename,
    ];

    let process = await spawn(ffmpeg, ffmpegArgs);

    await uploadFileToS3(srcBucket, mp4Filename, process.stdout.toString());

    // Return
    return {
        'status1': process.stdout.toString(),
        'status2': process.stderr.toString(),
        'mp4Filename': mp4Filename,
    };
};

/**
 * Download the source file.
 * @param srcUrl
 * @param inputFilename
 * @returns {Promise<*>}
 */
async function downloadSourceFile(srcUrl, inputFilename)
{
    try {
        const writeStream = await fs.createWriteStream(inputFilename);
        await request(srcUrl).pipe(writeStream);
        return {
            'status': true,
            'message': 'Success download source file.'
        };
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed download source file.',
            'err': err
        };
    }
}

/**
 * Upload file to s3
 * @param bucket
 * @param key
 * @param streamData
 * @returns {Promise<*>}
 */
async function uploadFileToS3(bucket, key, streamData) {
    // Upload file to s3
    let paramsDst = {
        Bucket: bucket,
        Key: key,
        Body: streamData,
    };
    try {
        const resultUpload = await s3.putObject(paramsDst).promise();
        return {
            'status': true,
            'message': 'Success upload to s3.'
        };
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed upload to s3.',
            'err': err
        };
    }
}