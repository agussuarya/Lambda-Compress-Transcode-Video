let spawn = require('child_process').spawn;
const child_process = require('child_process');
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
    const dstBucket = process.env.S3_BUCKET_OUTPUT;
    const dstKey = srcKey;

    // Create temporary input/output filenames that we can clean up afterwards.
    const inputFilenameTmp = tempy.file();
    const mp4Filename = tempy.file({ extension: 'mp4' });

    // Download the source file.
    try {
        await downloadFileFromS3(srcBucket, srcKey, inputFilenameTmp);
    } catch (err) {
        return {
            'status': false,
            'message': 'Failed download file.',
            'error': err
        };
    }

    // Copy file
    // try {
    //     await copyFile(inputFilenameTmp, mp4Filename);
    // } catch (err) {
    //     return {
    //         'status': false,
    //         'message': 'Failed copy file.',
    //         'error': err
    //     };
    // }

    // Use the Exodus ffmpeg bundled executable.
    const ffmpeg = await path.resolve(__dirname, 'exodus', 'bin', 'ffmpeg');

    // Compress & transcode video using ffmpeg.
    const ffmpegArgs = [
        '-y',
        '-i', inputFilenameTmp,
        '-vcodec', 'h264',
        '-acodec', 'aac',
        '-b:v', '2252800',
        '-b:a', '163840',
        '-crf', '28',
        mp4Filename,
    ];

    try {
        // Compress & transcode video
        preprocessingVideo(ffmpeg, ffmpegArgs);

        console.log('Before compress & transcode video: ' + getFilesizeInBytes(inputFilenameTmp)/1024 + ' KB');
        console.log('After compress & transcode video: ' + getFilesizeInBytes(mp4Filename)/1024 + ' KB');
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed compress & transcode video using ffmpeg.',
            'error': err
        };
    }

    // Upload file to s3
    try {
        let paramsDst = {
            Bucket: dstBucket,
            Key: dstKey,
            Body: fs.createReadStream(mp4Filename),
        };
        const resultUpload = await s3.putObject(paramsDst).promise();
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed upload to s3.',
            'error': err
        };
    }

    // Return
    return {
        'status': true,
        'message': 'Successfully compress & transcode video.',
    };
};

/**
 * Download file from s3
 * @param bucket
 * @param key
 * @param toFile
 * @returns {Promise<any>}
 */
function downloadFileFromS3 (bucket, key, toFile) {
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

/**
 * Get file size in byte
 * @param filename
 * @returns {*}
 */
function getFilesizeInBytes(filename) {
    const stats = fs.statSync(filename);
    return Number(stats["size"]).toFixed(2);
}

/**
 * Copy file
 * @param fileFrom
 * @param fileTo
 * @returns {Promise<any>}
 */
function copyFile (fileFrom, fileTo) {
    return new Promise((resolve, reject) => {
        fs.copyFile(fileFrom, fileTo, (err) => {
            if (err) reject();
            console.log('Source file was copied to destination');
            resolve();
        });
    });
}

/**
 * Convert & trasncode video
 * @param ffmpeg
 * @param ffmpegArgs
 */
function preprocessingVideo(ffmpeg, ffmpegArgs) {
    //ffmpeg -i compress_1560826543999.mp4 -y -vcodec h264 -acodec aac -b:v 2252800 -b:a 163840 compress_1560826543999_result.mp4

    const processFfmpeg = child_process.spawnSync(ffmpeg, ffmpegArgs, {
        stdio: 'pipe',
        stderr: 'pipe'
    });

    // Error...
    // processFfmpeg.stdout.on('data', (data) => {
    //     console.log(`stdout: ${data}`);
    // });
    // processFfmpeg.stderr.on('data', (data) => {
    //     console.log(`stderr: ${data}`);
    // });
    // processFfmpeg.on('close', (statusCode) => {
    //     console.log(`Child process exited with code ${statusCode}`);
    //     if (statusCode === 0) {
    //         console.log('Compress & transcode video successfully');
    //     }
    // });
}
