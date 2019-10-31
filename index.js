let spawn = require('child_process').spawn;
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const request = require('request');
const tempy = require('tempy');
const s3 = new AWS.S3();
const mysql = require('mysql');
const axios = require('axios').default;

exports.handler = async function(event, context, callback) {
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    const srcBucket = event.Records[0].s3.bucket.name;
    const dstBucket = process.env.S3_BUCKET_OUTPUT;
    const dstKey = srcKey;
    const dstKeyThumb = removeExtension(srcKey) + '.png';

    // Create temporary input/output filenames that we can clean up afterwards.
    const inputFilenameTmp = tempy.file();
    const mp4Filename = tempy.file({ extension: 'mp4' });
    const pngFilename = tempy.file({ extension: 'png' });
    const pngCompressFilename = tempy.file({ extension: 'png' });

    // Update row table in rds
    const fileName1 = getFilename(srcKey);
    const id1  = getMetadataIdFromFilename(fileName1);
    let updateMysql1Result = await updateDataTableRds1(id1);
    if (updateMysql1Result.status === false) {
        return updateMysql1Result;
    }

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

    // Create arg for compress & transcode video using ffmpeg.
    const ffmpegArgsVideo = [
        '-y',
        '-i', inputFilenameTmp,
        '-vcodec', 'h264',
        '-acodec', 'aac',
        '-b:v', '2252800',
        '-b:a', '163840',
        '-crf', '24',
        mp4Filename,
    ];

    const ffmpegArgsThumb = [
        '-y',
        '-i', inputFilenameTmp,
        '-ss', '00:00:00.000',
        '-vframes', '1',
        pngFilename,
    ];

    const ffmpegArgsThumbCompress = [
        '-y',
        '-i', pngFilename,
        '-vf', 'scale=144:-1',
        pngCompressFilename,
    ];

    // Compress & transcode video using ffmpeg
    try {
        preprocessingVideo(ffmpeg, ffmpegArgsVideo);

        console.log('Before compress & transcode video: ' + getFilesizeInBytes(inputFilenameTmp)/1024 + ' KB');
        console.log('After compress & transcode video: ' + getFilesizeInBytes(mp4Filename)/1024 + ' KB');

        createThumb(ffmpeg, ffmpegArgsThumb);
        resizeThumb(ffmpeg, ffmpegArgsThumbCompress);
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed compress & transcode video using ffmpeg.',
            'error': err
        };
    }

    // Upload video file to s3
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

    // Upload compressed thumb file to s3
    try {
        let paramsDst = {
            Bucket: dstBucket,
            Key: dstKeyThumb,
            Body: fs.createReadStream(pngCompressFilename),
        };
        const resultUpload = await s3.putObject(paramsDst).promise();
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed upload to s3.',
            'error': err
        };
    }

    // Update row table in rds
    try {
        const fileName = getFilename(srcKey);
        const id  = getMetadataIdFromFilename(fileName);
        const fullPathPreprocessingVideo = getFullPathFileS3(process.env.S3_REGION_OUTPUT, dstBucket, dstKey);
        const fullPathThumbVideo = getFullPathFileS3(process.env.S3_REGION_OUTPUT, dstBucket, dstKeyThumb);

        await updateDataTableRds2(id, fullPathPreprocessingVideo, fullPathThumbVideo);
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed update row table mysql 2.',
            'error': err
        };
    }

    await callApi(id);

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

/**
 * Create thumb from video
 * @param ffmpeg
 * @param ffmpegArgs
 */
function createThumb(ffmpeg, ffmpegArgs) {
    const processFfmpeg = child_process.spawnSync(ffmpeg, ffmpegArgs, {
        stdio: 'pipe',
        stderr: 'pipe'
    });
}

/**
 * Resize thumb from image
 * @param ffmpeg
 * @param ffmpegArgs
 */
function resizeThumb(ffmpeg, ffmpegArgs) {
    const processFfmpeg = child_process.spawnSync(ffmpeg, ffmpegArgs, {
        stdio: 'pipe',
        stderr: 'pipe'
    });
}

/**
 * Get full path file from s3
 * @param region
 * @param bucket
 * @param key
 * @returns {string}
 */
function getFullPathFileS3(region, bucket, key) {
    return 'https://' + bucket + '.s3-' + region + '.amazonaws.com/' + key;
}

/**
 * Relative path = sub_folder/filename.mp4 => filename.mp4
 * @param relativePath
 * @returns {string}
 */
function getFilename(relativePath) {
    return relativePath.split('/').pop();
}

/**
 * Custom with your logic...
 *
 * Example:
 * Filename = xxx_60.mp4 => id = 60
 *
 * @param filename
 */
function getMetadataIdFromFilename(filename) {
    // Get without extension
    let filenames = filename.split('.');
    filenames.pop();

    // Get metadata id
    return filenames[0].split('_').pop();
}

/**
 * Custom with your logic...
 *
 * Example: we will run query sql (Update table).
 * @param id
 * @returns {Promise<*>}
 */
async function updateDataTableRds1(id) {
    const tableToUpdate = process.env.RDS_UPDATE_TABLE_NAME;
    const additionalUpdate = process.env.RDS_UPDATE_ADDITIONAL_UPDATE_1;
    const pkName = process.env.RDS_UPDATE_PK_NAME;
    const querySql = "UPDATE " + tableToUpdate + " SET " + additionalUpdate + " WHERE " + pkName + "=" + id + ";";
    let connection = mysql.createConnection({
        host: process.env.RDS_HOST,
        user: process.env.RDS_USER,
        password: process.env.RDS_PASSWORD,
        database: process.env.RDS_DATABASE,
    });

    let promise = new Promise(function(resolve, reject) {
        connection.query(
            querySql,
            function (error, results, fields) {
                if (error) {
                    connection.destroy();
                    reject(error)
                } else {
                    connection.end(function (error) { reject(error);});
                    resolve(results);
                }
            });
    });

    try {
        await promise;
        return {
            'status': true,
            'message': 'Success update row table mysql 1.'
        };
    } catch(err) {
        return {
            'status': false,
            'message': 'Failed update row table mysql 1.',
            'error': err
        };
    }
}

/**
 * Custom with your logic...
 *
 * Example: we will run query sql (Update table).
 * @param id
 * @param videoUrl
 * @param thumbUrl
 * @returns {Promise<*>}
 */
function updateDataTableRds2(id, videoUrl, thumbUrl) {
    const tableToUpdate = process.env.RDS_UPDATE_TABLE_NAME;
    const additionalUpdate = process.env.RDS_UPDATE_ADDITIONAL_UPDATE_2;
    const pkName = process.env.RDS_UPDATE_PK_NAME;
    const querySql = "UPDATE " + tableToUpdate
        + " SET video_url='" + videoUrl + "', "
        + "thumb_url='" + thumbUrl + "', "
        + additionalUpdate
        + " WHERE " + pkName + "=" + id + ";";
    let connection = mysql.createConnection({
        host: process.env.RDS_HOST,
        user: process.env.RDS_USER,
        password: process.env.RDS_PASSWORD,
        database: process.env.RDS_DATABASE,
    });

    return new Promise(function(resolve, reject) {
        connection.query(
            querySql,
            function (error, results, fields) {
                if (error) {
                    connection.destroy();
                    reject(error)
                } else {
                    connection.end(function (error) { reject(error);});
                    resolve(results);
                }
            });
    });
}

/**
 * Remove extension from filename
 * @param filename
 * @returns {string}
 */
function removeExtension(filename)
{
    return filename.split('.').slice(0, -1).join('.')
}

async function callApi(id)
{
    try {
        const response = await axios.post(process.env.API_URL_1 + '/' + id + '/' + process.env.API_URL_2);
        // console.log(response);
    } catch (error) {
        // console.error(error);
    }
}