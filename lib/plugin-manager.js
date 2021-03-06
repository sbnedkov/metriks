var _      = require('underscore');
var async  = require('async');
var exec   = require('child_process').exec;
var fs     = require('fs');
var glob   = require('glob');
var os     = require('os');
var sys    = require('sys');
var util   = require('util');
var path   = require('path');
var mkdirp = require('mkdirp');
var Plugin = require('./plugin').Plugin;

exports               = module.exports = new PluginManager();
exports.PluginManager = PluginManager;

function PluginManager(config) {
  // mgr config
  this.cli = {
    info:  function(str) {console.log('INFO:  ' + str); },
    debug: function(str) {console.log('DEBUG: ' + str); },
    error: function(str) {console.log('ERROR: ' + str); },
    fatal: function(str) {console.log('FATAL: ' + str); },
    ok:    function(str) {console.log('OK:    ' + str); },
  };
  this.pluginDir   = '/tmp';
  this.concurrency = 2;

  // plugin config
  this.rrdDir       = '/tmp';
  this.pngDir       = '/tmp';
  this.autoWritePng = false;

  // internals
  this._q          = {};
  this._timers     = [];
  this._plugins    = {};
  _.extend(this, config);
}

PluginManager.prototype.find = function (pattern, cb) {
  var self  = this;

  self._loadAll(false, function(err) {
    if (err) {
      throw err;
    }

    var plugin;

    if (!plugin) {
      plugin = _.findWhere(self._plugins, {rrdFile: pattern});
    }
    if (!plugin) {
      plugin = _.findWhere(self._plugins, {name: pattern});
    }

    return cb(null, plugin);
  });
};

PluginManager.prototype.graph = function (pattern) {
  var self = this;
  self._loadAll(false, function(err) {
    if (err) {
      throw err;
    }

    var plugin = self.find(pattern);
    self._writePNG(plugin, function (err) {
      if (err) {
        throw err;
      }

      self.cli.info(util.format('open %s', plugin.pngFile));
    });
  });
};

PluginManager.prototype._loop = function(self, plugin, cb) {
  self.cli.info(util.format(
    'Running plugin %s at interval %s to %s',
    plugin.name,
    plugin.interval,
    plugin.rrdFile
  ));

  plugin.run(cb);

  // Reschedule
  self._timers.push(setTimeout(function () {
    self._q.push(plugin);
  }, plugin.interval * 1000));
};

PluginManager.prototype.start = function () {
  var self = this;
  self._loadAll(false, function(err) {
    if (err) {
      throw err;
    }

    _.each(self._plugins, function(plugin) {
      // Loop plugin
      if (!plugin.executable) {
        self.cli.debug(util.format('Skipping plugin %s as it is not executable', plugin.name));
        return;
      }
      if (!plugin.enabled) {
        self.cli.debug(util.format('Skipping plugin %s as it is not enabled', plugin.name));
        return;
      }

      self._q = async.queue(function(plugin, cb) {
        // We need to pass on `self`
        self._loop(self, plugin, cb);
      }, self.concurrency);
      self._q.drain = function() {
        self.cli.debug(util.format('waiting for new items to be pushed to queue'));
      };
      self._q.push(plugin);
    });
  });
};

/**
 * Clear all timers
 */
PluginManager.prototype.stop = function () {
  for (var i in self._timers) {
    clearTimeout(self._timers[i]);
  }
};


/**
 * Load plugin configuration from disk
 * @param  {Function} cb
 * @return {[type]}
 */
PluginManager.prototype._loadAll = function (reset, cb) {
  var self     = this;

  if (_.keys(self._plugins).length && reset !== true) {
    return cb(null);
  }

  if (!fs.existsSync(self.pluginDir)) {
    return cb(util.format('Plugin directory %s does not exist', self.pluginDir));
  }

  glob(self.pluginDir + '/*', {}, function (err, files) {
    if (err) {
      return cb(err);
    }

    files.forEach(function (pluginFile) {
      var plugin = new Plugin({
        pluginFile  : pluginFile,
        rrdDir      : self.rrdDir,
        pngDir      : self.pngDir,
        autoWritePng: self.autoWritePng,
        cli         : self.cli,
      });

      plugin.reload(function(err) {
        if (err) {
          return cb(err);
        }

        self._plugins[plugin.name] = plugin;

        if (_.keys(self._plugins).length === files.length) {
          cb(null);
        }
      });
    });
  });
};

