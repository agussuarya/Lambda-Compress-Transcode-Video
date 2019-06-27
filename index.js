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
    const srcRegion = event.Records[0].awsRegion;
    const dstBucket = process.env.S3_BUCKET_OUTPUT;
    const dstKey = 'preprocessing_' + srcKey;

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
            'err': err
        };
    }

    // Copy file
    // try {
    //     await copyFile(inputFilenameTmp, mp4Filename);
    // } catch (err) {
    //     return {
    //         'status': false,
    //         'message': 'Failed copy file.',
    //         'err': err
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
        mp4Filename,
    ];

    //ffmpeg -i compress_1560826543999.mp4 -y -vcodec h264 -acodec aac -b:v 2252800 -b:a 163840 compress_1560826543999_result.mp4

    let processFfmpeg;
    try {
        // TES 1
        // processFfmpeg = spawn(ffmpeg, ffmpegArgs);
        //
        // processFfmpeg.stdout.on('data', (data) => {
        //     console.log(`start`);
        // });
        //
        // processFfmpeg.stderr.on('data', (data) => {
        //     console.log(`stderr: ${data}`);
        // });
        //
        // processFfmpeg.on('close', (code) => {
        //     console.log(`child process exited with code ${code}`);
        // });
        // TES 1

        // TES 2
        // processFfmpeg = await child_process.spawnSync(ffmpeg, ffmpegArgs);
        // TES 2

        // TES 3
        //preprocessingVideo2(ffmpeg, ffmpegArgs);
        // TES 3

        // TES 4
        //await preprocessingVideo3(ffmpeg, ffmpegArgs);
        // TES 4

        // TES 5
        const processFfmpeg = child_process.spawnSync(ffmpeg, ffmpegArgs, {
            stdio: 'pipe',
            stderr: 'pipe'
        });
        // TES 5

        console.log('size before: ' + getFilesizeInBytes(inputFilenameTmp)/1024 + ' KB');
        console.log('size after: ' + getFilesizeInBytes(mp4Filename)/1024 + ' KB');
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
            Body: fs.createReadStream(mp4Filename),
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

function getFilesizeInBytes(filename) {
    const stats = fs.statSync(filename);
    return stats["size"];
}

function copyFile (fileFrom, fileTo) {
    return new Promise((resolve, reject) => {
        fs.copyFile(fileFrom, fileTo, (err) => {
            if (err) reject();
            console.log('Source file was copied to destination');
            resolve();
        });
    });
}

function preprocessingVideo1(ffmpeg, ffmpegArgs) {
    return new Promise((resolve, reject) => {
        let processFfmpeg = spawn(ffmpeg, ffmpegArgs);
        processFfmpeg.on('exit', (statusCode) => {
            if (statusCode === 0) {
                console.log('conversion successful');
                resolve();
            }
        });

        processFfmpeg
            .stderr
            .on('data', (err) => {
                console.log('err:', new String(err));
                reject()
            });
    });
}

function preprocessingVideo2(ffmpeg, ffmpegArgs) {
    const processFfmpeg = spawn(ffmpeg, ffmpegArgs);

    processFfmpeg.stdout.on('data', (data) => {
        console.log(`stdOUT: ${data}`);
    });
    processFfmpeg.stderr.on('data', (data) => {
        console.log(`stdERR: ${data}`);
    });
    processFfmpeg.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });
}
