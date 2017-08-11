'use strict';

const pkg = require('../package.json');
const featureClient = require('feature-client');
const ClientWrapper = require('./ClientWrapper');
const debug = require('debug')('XPRMNTL:hapi:index');

exports.register = (server, options, next) => {

  options = Object.assign({
    callback: () => {},
    cookieName: 'xpr.config',
  }, options);
  featureClient.configure(options);

  if (options.cronTime) {
    featureClient.cron(options.cronTime, options.callback);
  }

  featureClient.use(ClientWrapper(options));

  if (options.announce) {
    debug(`Announcing experiments: ${ JSON.stringify(options.experiments) }`)
    featureClient.announce(options.callback);
  }

  server.state('xpr.config', { encoding: 'base64' });
  server.ext({
    type: 'onPreHandler',
    method: featureClient.hapi,
  });

  return next();
};

exports.register.attributes = { pkg };
