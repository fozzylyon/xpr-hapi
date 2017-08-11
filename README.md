# xpr-hapi

## Install
```bash
npm install xpr-hapi
```

## Options
Can be configured with options following this schema:

```javascript
{
  timeout: 10000,
  featureUrl: 'https://example.com/',
  devKey: 'xxxxxxx',
  cookieName: 'xpr.config'
  experiments: [
    {
      name: 'featureFlagTest',
      default: true,
      description: 'This is a test feature flag.',
    },
  ],
  cronTime: '* * * * *',
  callback: (err, settings) => {
    // ...
  },
  announce: true,
  reference: 'local',
}
```

Options specific to this plugin:
* `crontTime`:  Used to call `featureClient.cron(...);`.  Defaults off
* `announce`:  Used to determine if experiments are announced via `featureClient.announce()`.  Defaults off
* `callback`: The callback passed `cron()` and `announce()`

## Example
Below is an example plugin loading script:
```javascript
'use strict';

const xprHapi = require('xpr-hapi');

module.exports = {
  register: xprHapi,

  options: {
    featureUrl: 'https://example.com/',
    devKey: '1z-2a-3y-4b-5x-6c',
    experiments: [
      {
        name: 'featureFlagTest',
        default: true,
        description: 'This is a test feature flag.',
      },
    ],
    cronTime: '* * * * *',
    announce: false,
    reference: 'int',
  },
};
```
