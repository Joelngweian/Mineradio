'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createRequestAbortScope, pipeWebBodyToResponse } = require('../server/services/request-lifecycle');
const { createYtmAudioService } = require('../server/services/ytm-audio');
const { cancelUpdateJobs, updateDownloadJobs } = require('../server/update-service');

function createResponse() {
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.write = () => true;
  response.end = () => { response.writableEnded = true; };
  return response;
}

test('request abort scope stops a pending upstream body when the audio client disconnects', async () => {
  const request = new EventEmitter();
  const response = createResponse();
  const scope = createRequestAbortScope(request, response);
  let canceled = 0;
  let finishRead;
  const body = {
    getReader() {
      return {
        read: () => new Promise(resolve => { finishRead = resolve; }),
        cancel: async () => {
          canceled += 1;
          finishRead({ done: true });
        },
      };
    },
  };

  const streaming = pipeWebBodyToResponse(response, body, scope.signal);
  await new Promise(resolve => setImmediate(resolve));
  response.emit('close');

  await assert.rejects(streaming, error => error && error.code === 'CLIENT_DISCONNECTED');
  assert.equal(scope.signal.aborted, true);
  assert.equal(canceled, 1);
  scope.dispose();
});

test('request abort scope ignores the normal close event after a completed response', () => {
  const request = new EventEmitter();
  const response = createResponse();
  response.writableEnded = true;
  const scope = createRequestAbortScope(request, response);

  response.emit('close');

  assert.equal(scope.signal.aborted, false);
  scope.dispose();
});

test('YTM audio cleanup drops resolved format cache entries', async () => {
  let resolves = 0;
  const audio = createYtmAudioService({
    Innertube: {
      create: async () => ({
        getStreamingData: async () => {
          resolves += 1;
          return { mimeType: 'audio/mp4', url: 'https://audio.example/stream', contentLength: '42' };
        },
      }),
    },
    requestJson: async () => ({}),
    getCookie: () => 'SID=one',
    getVisitorData: async () => '',
    getContentPoToken: async () => 'po-token',
    userAgent: 'test-agent',
  });

  await audio.resolveAudioFormat('video-id');
  assert.equal(audio.getState().cachedFormats, 1);
  audio.clear();
  assert.equal(audio.getState().cachedFormats, 0);
  await audio.resolveAudioFormat('video-id');
  assert.equal(resolves, 2);
});

test('server shutdown cancels only in-flight update jobs and aborts their fetches', () => {
  const savedJobs = Array.from(updateDownloadJobs.entries());
  updateDownloadJobs.clear();
  const controller = new AbortController();
  const job = {
    id: 'shutdown-job',
    status: 'downloading',
    abortController: controller,
    updatedAt: 0,
  };
  updateDownloadJobs.set(job.id, job);

  try {
    assert.deepEqual(cancelUpdateJobs('SERVER_SHUTDOWN'), ['shutdown-job']);
    assert.equal(controller.signal.aborted, true);
    assert.equal(job.status, 'cancelled');
    assert.equal(job.error, 'UPDATE_CANCELLED');
    assert.match(job.message, /已取消/);
  } finally {
    updateDownloadJobs.clear();
    savedJobs.forEach(([id, value]) => updateDownloadJobs.set(id, value));
  }
});
