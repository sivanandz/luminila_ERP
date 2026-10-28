/**
 * fs.readlink workaround for the isolated build.
 *
 * On some Windows volumes (this repository lives on an external E: drive),
 * fs.readlink returns EISDIR for an ordinary file instead of EINVAL. Next's
 * build trace plugin (next-trace-entrypoints-plugin.js) treats every error
 * except EINVAL/ENOENT/UNKNOWN as fatal, so a webpack build cannot finish when
 * its dependencies sit on such a volume.
 *
 * This shim normalises EISDIR to EINVAL and leaves successful reads untouched,
 * so real symlinks still resolve. It is loaded only by
 * scripts/build-static-isolated.mjs, and only when a probe detects the broken
 * behaviour. It is a filesystem workaround, not a change to application code.
 */

"use strict";

const fs = require("node:fs");

const originalReadlink = fs.readlink;
const originalReadlinkSync = fs.readlinkSync;
const originalPromisesReadlink = fs.promises && fs.promises.readlink;

function normalize(error) {
    if (error && error.code === "EISDIR") {
        const mapped = new Error(error.message);
        mapped.code = "EINVAL";
        mapped.errno = -22;
        mapped.syscall = "readlink";
        mapped.path = error.path;
        return mapped;
    }
    return error;
}

fs.readlink = function readlink(path, options, callback) {
    const actualOptions = typeof options === "function" ? undefined : options;
    const done = typeof options === "function" ? options : callback;
    const handle = (error, result) => (error ? done(normalize(error)) : done(null, result));
    if (actualOptions === undefined) {
        originalReadlink.call(fs, path, handle);
    } else {
        originalReadlink.call(fs, path, actualOptions, handle);
    }
};

fs.readlinkSync = function readlinkSync(...args) {
    try {
        return originalReadlinkSync.apply(fs, args);
    } catch (error) {
        throw normalize(error);
    }
};

if (typeof originalPromisesReadlink === "function") {
    fs.promises.readlink = function readlink(...args) {
        return originalPromisesReadlink.apply(fs.promises, args).catch((error) => {
            throw normalize(error);
        });
    };
}
