'use strict';

/**
 * Module Dependencies
 */
const expLib = require('xpr-experiment');
const debug = require('debug')('XPRMNTL:hapi:ClientWrapper');

module.exports = ClientWrapper;

function ClientWrapper(config) {

  if (!(this instanceof ClientWrapper)) {
    return new ClientWrapper(config);
  }

  if (!config) config = {};

  /**
   * user read/write methods
   */
  this.readExps = config.readExps || this.defaultReadExps;
  this.saveExps = config.saveExps || this.defaultSaveExps;

  this.cookieName = config.cookieName || 'xpr.config';

  /**
   * These are the two experiments we're working on throughout
   */
  this.exps = {
    app: expLib(),
    shared: expLib(),
  };

  /**
   * These are the hashes of the current configuration
   * of experiments of each type. This lets us know if the user
   * has outdated experiments data.
   */
  this.hashes = {
    app: null,
    shared: null,
  };

  /**
   * This stores the most recent fetched data
   */
  this.lastFetch = null;

  /**
   * Have we had a successful fetch?
   */
  this.fetched = false;

  var self = this;

  return function init(client) {

    self.client = client;

    /**
     * Backed up remote functions
     */
    var _load = client.load;
    var _announce = client.announce;

    /**
     * Memoized functions
     */
    client.load = self.memoize(_load);
    client.announce = self.memoize(_announce);
    client.hapi = self.middleware.bind(self);

    client.cookieName = self.cookieName;
  };
}


/**
 * Memoizes the functions and binds to client
 */
ClientWrapper.prototype.memoize = function(fn) {
  var self = this;
  return function(cb) {
    return fn.call(this.client, cb).then(function success(config) {
      debug('dowhatnow?!');
      self.saveLast(config);
    }, function failure(data) {
      var err = data[0]
        , defaults = data[1];

      debug('Fetch err: ', err);
      self.saveLast(defaults, true);
    });
  };
};


/**
 * Saves the last-fetch configuration
 *
 * If there is already a configuration, this does not override that
 * if the previous call was an error. This allows a startup to fetch
 * correct data, and on failure, not fall back to `default` data
 */
ClientWrapper.prototype.saveLast = function(config, optional) {
  if (optional && this.fetched) return;

  var ref = this.client.getReference();

  this.hashes.app = this.exps.app.configure(config.app || {}, ref);
  if (config.shared && config.shared.experiments) this.hashes.shared = this.exps.shared.configure(config.shared, ref);

  this.fetched = true;
  this.lastFetch = config;
};


/**
 * hapi middleware that attaches req.feature
 */
ClientWrapper.prototype.middleware = function(req, reply) {
  var exps = this.readExps(req, reply);

  var togglers = Object.keys(req.query).reduce(function (obj, key) {
    if (! ~key.indexOf('xpr.')) return obj;

    obj[key.replace('xpr.','')] = req.query[key];
    return obj;
  }, {});

  if (! exps) exps = { app: {}, shared: {} };

  var userContexts = {
    app: this.exps.app.contextFor(exps.bucket, exps.userID),
    shared: this.exps.shared.contextFor(exps.bucket, exps.userID),
  };

  var userExps = {
    app: this.exps.app.readFor(userContexts.app, exps.app),
    shared: this.exps.shared.readFor(userContexts.shared, exps.shared),
  };

  Object.keys(togglers).map(function(key) {
    var val = togglers[key];

    try {
      userExps.app.features[key] = JSON.parse(val);
      userExps.app.dirtyFeatures.push(key);
    } catch(e) {
      // Valid use-case
    }

  });

  // TODO: only if the user is outdated, generate a new cookie.
  if (exps.userID) this.saveExps(exps.userID, userExps, reply);

  // QQ: Do I want to save a new cookie every time, to keep it updated?

  req.feature = reqFeature.bind(this);
  req.features = userExps;

  return reply.continue();

  function reqFeature(name, fallback) {
    if (undefined === fallback) fallback = false;

    if (undefined === userExps.app.features[name] === userExps.shared.features[name]) return fallback;

    var statuses = {
      app: this.exps.app.feature(name, userExps.app),
      shared: this.exps.shared.feature(name, userExps.shared),
    };

    return statuses.app || statuses.shared;
  }
};

/**
 * Default deserializer for the user object in hapi
 *
 * @param  {Object} req Hapi.js request object
 * @return {Object}     `user` object
 *
 * Example return:
 *
 * ```js
 * {
 *   id: string,
 *   bucket: int,
 *   hashes: {
 *     app: string,
 *     shared: string
 *   }
 *   dirty: {
 *     app: {
 *       key1: value1,
 *       ...
 *       keyN: valueN,
 *     },
 *     shared: {
 *       key1: value1,
 *       ...
 *       keyN: valueN,
 *     }
 *   }
 * }
 * ```
 */

ClientWrapper.prototype.defaultReadExps = function(req, reply) {
  var defaultCookie = {
    userID: req.user && (req.user.id || req.user._id) || '__anon__',
  };

  var rawCookie = req.state[this.cookieName];
  if (! rawCookie) return defaultCookie;

  var exps, userID, bucket, hashes, dirty;

  var matcher = /u:([^«]*)«b:([^╣]*)╣app:«s:([^«]*)«d:([^║]*)║╣shared:«s:([^«]*)«d:([^║]*)║/;
  var matches = matcher.exec(rawCookie);

  // I hate try/catch in JS, but we're using JSON.parse, and that throws exceptions...
  try {

    userID = matches[1];

    if (userID !== defaultCookie.userID) throw new Error('New cookie user');

    bucket = matches[2];
    hashes = {
      app: matches[3],
      shared: matches[5],
    };
    dirty = {
      app: JSON.parse(matches[4]),
      shared: JSON.parse(matches[6]),
    };

    exps = {
      userID: userID,
      bucket: bucket,
      app: {
        userId: userID,
        bucket: bucket,
        stamp: hashes.app,
        features: dirty.app,
        dirtyFeatures: Object.keys(dirty.app),
      },
      shared: {
        userId: userID,
        bucket: bucket,
        stamp: hashes.shared,
        features: dirty.shared,
        dirtyFeatures: Object.keys(dirty.shared),
      },
    };

  } catch (e) {
    reply.unstate(this.cookieName);
    exps = defaultCookie;
  }

  return exps;
};

ClientWrapper.prototype.defaultSaveExps = function(id, config, reply) {
  var serial = this.serializeExps(id, config);
  var expiration = new Date();
  expiration.setYear(expiration.getFullYear() + 1);

  reply.state(this.cookieName, serial, { expiresIn: expiration });
};


ClientWrapper.prototype.serializeExps = function(id, data) {
  var serial = 'u:' + id + '«b:' + data.app.bucket;

  serial += this.serializeAppData('app', data.app);
  serial += this.serializeAppData('shared', data.shared);

  return serial;
};

ClientWrapper.prototype.serializeAppData = function(name, config) {
  var serial = '╣' + name + ':';

  serial += '«s:' + config.stamp;

  var dirty = config.dirtyFeatures.reduce(function(prev, curr) {
    prev[curr] = config.features[curr];

    return prev;
  }, {});

  serial += '«d:' + JSON.stringify(dirty);
  serial += '║';

  return serial;
};
