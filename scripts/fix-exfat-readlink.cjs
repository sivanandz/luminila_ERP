/**
 * Normalize readlink() on exFAT drives for the duration of this process.
 *
 * libuv reports EISDIR when readlink() targets a regular file on exFAT
 * (NTFS correctly returns EINVAL). Webpack and enhanced-resolve treat EINVAL
 * as "not a symlink" and continue, but EISDIR aborts the build. This preload
 * converts that spurious EISDIR back into EINVAL so builds behave the same on
 * exFAT repos as on NTFS.
 *
 * Loaded via `node --require` in the build scripts only.
 */
'use strict';

const fs = require('fs');

function toEINVAL(err) {
    if (err && err.code === 'EISDIR' && err.syscall === 'readlink') {
        const rewritten = new Error(`EINVAL: invalid argument, readlink '${err.path}'`);
        rewritten.code = 'EINVAL';
        rewritten.errno = -22;
        rewritten.syscall = 'readlink';
        rewritten.path = err.path;
        return rewritten;
    }
    return err;
}

const origReadlink = fs.readlink;
fs.readlink = function readlink(path, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }
    origReadlink(path, options, (err, linkString) => {
        callback(toEINVAL(err), linkString);
    });
};

const origReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function readlinkSync(path, options) {
    try {
        return origReadlinkSync(path, options);
    } catch (err) {
        throw toEINVAL(err);
    }
};

// fs.promises exposes its own binding; patch it separately.
if (fs.promises && typeof fs.promises.readlink === 'function') {
    const origPromiseReadlink = fs.promises.readlink;
    fs.promises.readlink = function readlink(path, options) {
        return origPromiseReadlink.call(fs.promises, path, options).catch((err) => {
            throw toEINVAL(err);
        });
    };
}
