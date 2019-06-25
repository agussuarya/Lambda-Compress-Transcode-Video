let spawn = require('child_process').spawn;
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const request = require('request');
const tempy = require('tempy');
const s3 = new AWS.S3();

exports.handler = async function(event, context, callback) {
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    const srcBucket = event.Records[0].s3.bucket.name;
    const srcRegion = event.Records[0].awsRegion;
    const srcFullpath = 'https://' + srcBucket + '.s3-' + srcRegion + '.amazonaws.com/' + srcKey;
    const dstBucket = process.env.S3_BUCKET_OUTPUT;
    const dstKey = 'preprocessing_' + srcKey;

    // Create temporary input/output filenames that we can clean up afterwards.
    const inputFilenameTmp = tempy.file();
    const mp4Filename = tempy.file({ extension: 'mp4' });

    // Download the source file.
    await downloadImageS3(srcBucket, srcKey, inputFilenameTmp);

    // Use the Exodus ffmpeg bundled executable.
    const ffmpeg = await path.resolve(__dirname, 'exodus', 'bin', 'ffmpeg');

    // Compress & transcode video using ffmpeg.
    const ffmpegArgs = [
      '-i', inputFilenameTmp,
        mp4Filename,
    ];
    let processFfmpeg;
    try {
        processFfmpeg = await spawn(ffmpeg, ffmpegArgs);
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed compress & transcode video using ffmpeg.',
            'err': err
        };
    }

    // Upload file to s3
    try {
        let paramsDst = {
            Bucket: dstBucket,
            Key: dstKey,
            Body: fs.createReadStream(inputFilenameTmp),
        };
        const resultUpload = await s3.putObject(paramsDst).promise();
    } catch(err) {
        console.log(err);
        return {
            'status': false,
            'message': 'Failed upload to s3.',
            'err': err
        };
    }

    // Return
    return {
        'inputFilenameTmp': inputFilenameTmp,
        'mp4Filename': mp4Filename,
    };
};

async function downloadImageS3 (bucket, key, toFile) {
    return new Promise((resolve, reject) => {
        const params = { Bucket: bucket, Key: key };
        const s3Stream = s3.getObject(params).createReadStream();
        const fileStream = fs.createWriteStream(toFile);
        s3Stream.on('error', reject);
        fileStream.on('error', reject);
        fileStream.on('close', () => { resolve(toFile);});
        s3Stream.pipe(fileStream);
    });
}
