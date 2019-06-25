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
    let writeStream;
    try {
        writeStream = await fs.createWriteStream(inputFilenameTmp);
        //await request(srcFullpath).pipe(writeStream);

        await new Promise((resolve, reject) => {
            let stream = request(srcFullpath)
                .pipe(writeStream)
                .on('finish', () => {
                    console.log(`The file is finished downloading.`);
                    resolve();
                })
                .on('error', (error) => {
                    console.log(`Error...`);
                    reject(error);
                });
        });
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed download source file.',
            'err': err
        };
    }

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


