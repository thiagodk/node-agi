var Promise = require('promise');
var Readable = require('readable-stream');
var EventEmitter = require('events').EventEmitter;
var state = require('./state');

function parseArgument(arg) {
  if (/^\w+$/.test(arg))
    return arg;
  return '"' + arg.replace(/"|\\/g, '\\$&') + '"';
}

var Context = function(stream) {
  EventEmitter.call(this);
  this.stream = new Readable();
  this.stream.wrap(stream);
  this.state = state.init;
  this.msg = "";
  var self = this;
  this.stream.on('readable', function() {
    //always keep the 'leftover' part of the message
    self.msg = self.read();
  });
  this.msg = this.read();
  this.sendQueue = [];
  this.variables = {};
  this.pending = null;
  this.stream.on('error', this.emit.bind(this, 'error'));
  this.stream.on('close', this.emit.bind(this, 'close'));
};

require('util').inherits(Context, EventEmitter);

Context.prototype.read = function() {
  var buffer = this.stream.read();
  if(!buffer) return this.msg;
  this.msg += buffer.toString('utf8');
  if(this.state === state.init) {
    if(this.msg.indexOf('\n\n') < 0) return this.msg; //we don't have whole message
    this.readVariables(this.msg);
  } else if(this.state === state.waiting) {
    if(this.msg.indexOf('\n') < 0) return this.msg; //we don't have whole message
    this.readResponse(this.msg);
  }
  return "";
};

Context.prototype.readVariables = function(msg) {
  var lines = msg.split('\n');
  for(var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var split = line.split(':')
    var name = split[0];
    var value = split[1];
    this.variables[name] = (value||'').trim();
  }
  this.emit('variables', this.variables);
  this.setState(state.waiting);
  return "";
};

Context.prototype.readResponse = function(msg) {
  var lines = msg.split('\n');
  for(var i = 0; i < lines.length; i++) {
    this.readResponseLine(lines[i]);
  }
  return "";
};

Context.prototype.readResponseLine = function(line) {
  if(!line) return;
  var parsed = /^(\d{3})(?: result=)(.*)/.exec(line);
  if(!parsed) {
    return this.emit('hangup');
  }
  var response = {
    code: parseInt(parsed[1]),
    result: parsed[2]
  };

  //our last command had a pending callback
  if(this.pending) {
    var pending = this.pending;
    this.pending = null;
    pending(null, response);
  }
  this.emit('response', response);
  if (this.sendQueue.length) {
    var queueObj = this.sendQueue.shift();
    this.pending = queueObj.cb;
    this.stream.write(queueObj.msg);
  }
}

Context.prototype.setState = function(state) {
  this.state = state;
};

Context.prototype.send = function(msg) {
  return new Promise(function(resolve, reject) {
    if (this.pending) {
      this.sendQueue.push({msg: msg, cb: resolve})
    } else {
      this.pending = resolve;
      this.stream.write(msg);
    }
  });
};

Context.prototype.exec = function() {
  var args = Array.prototype.slice.call(arguments, 0);
  return this.send('EXEC ' + args.map(function(arg) { return parseArgument(arg); }).join(' ') + '\n');
};

Context.prototype.verbose = function(msg, level) {
  level = parseInt(level);
  if (isNaN(level))
    level = 1;
  return this.send('VERBOSE ' + parseArgument(msg) + ' ' + level + '\n');
}

Context.prototype.getVariable = function(name) {
  return this.send('GET VARIABLE ' + parseArgument(name) + '\n');
};

Context.prototype.getFullVariable = function(expr) {
  return this.send('GET FULL VARIABLE ' + parseArgument(expr) + '\n');
}

Context.prototype.streamFile = function(filename, acceptDigits) {
  if (typeof acceptDigits === 'undefined')
    acceptDigits = "1234567890#*";
  return this.send('STREAM FILE ' + parseArgument(filename) + ' ' + parseArgument(acceptDigits) + '\n');
};

Context.prototype.waitForDigit = function(timeout) {
  timeout = parseInt(timeout);
  if (isNaN(timeout))
    timeout = 5000;
  return this.send('WAIT FOR DIGIT ' + timeout + '\n');
};

Context.prototype.hangup = function() {
  return this.send('HANGUP\n');
};

Context.prototype.end = function() {
  this.stream.end();
};

module.exports = Context;
