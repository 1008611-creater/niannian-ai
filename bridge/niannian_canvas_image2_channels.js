'use strict';

const {COMMON_ASPECT_RATIOS, COMMON_IMAGE_RESOLUTIONS, outputSizesForRatios} = require('./niannian_canvas_aspect_ratios');

// OpenLux verified gpt-image-2-c sizes. 4096x4096 returns ~2880x2880; 4096x2304 returns 3840x2160.
const OPENLUX_ASPECT_RATIOS = Object.freeze(['1:1', '16:9', '9:16']);
const OPENLUX_OUTPUT_SIZES = Object.freeze({
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536'
});

const CHANNELS = Object.freeze({
  'openlux-gpt-image-2-c': Object.freeze({
    id: 'openlux-gpt-image-2-c',
    provider: 'openlux',
    label: 'OpenLux Image2',
    resolutions: Object.freeze(['1k']),
    aspectRatios: OPENLUX_ASPECT_RATIOS,
    outputSizes: Object.freeze({'1k': '1024x1024'}),
    outputSizesByAspectRatio: Object.freeze({
      '1k': OPENLUX_OUTPUT_SIZES
    })
  }),
  'yunwu-gpt-image-2-c': Object.freeze({
    id: 'yunwu-gpt-image-2-c',
    provider: 'yunwu-agent-vault',
    label: '云雾 Image2 4K',
    resolutions: Object.freeze(['4k']),
    aspectRatios: Object.freeze(['9:16']),
    outputSizes: Object.freeze({'4k': '2160x3840'}),
    outputSizesByAspectRatio: Object.freeze({
      '4k': outputSizesForRatios(['9:16'])
    })
  }),
  'yunwu-gpt-image-2-c-edit': Object.freeze({
    id: 'yunwu-gpt-image-2-c-edit',
    provider: 'yunwu-agent-vault',
    label: '云雾 Image2 图改图 4K',
    resolutions: Object.freeze(['4k']),
    aspectRatios: Object.freeze(['16:9']),
    outputSizes: Object.freeze({'4k': '3840x2160'}),
    outputSizesByAspectRatio: Object.freeze({'4k': outputSizesForRatios(['16:9'])})
  })
});

function channelError(code, message, httpStatus = 422) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function clean(value, limit = 80) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function resolveImage2Channel(value) {
  const id = clean(value) || 'openlux-gpt-image-2-c';
  return CHANNELS[id] || null;
}

function normalizeImage2Spec(input = {}) {
  const referenceCount = Math.max(0, Number(input.referenceCount || input.inputAssetCount || 0) || 0);
  const requestedValue = clean(input.imageChannel || input.model || input.channel);
  const requestedChannel = resolveImage2Channel(requestedValue);
  // OpenLux supports both text-to-image and reference-image in one channel.
  if (requestedValue && !requestedChannel) throw channelError('CANVAS_IMAGE2_CHANNEL_INVALID', '请选择已接入的 Image2 作图渠道');
  const channel = requestedChannel || (referenceCount > 0 ? CHANNELS['openlux-gpt-image-2-c'] : CHANNELS['openlux-gpt-image-2-c']);
  const resolution = clean(input.resolution || channel.resolutions[0] || '1k', 8).toLowerCase();
  const aspectRatio = clean(input.aspectRatio || input.aspect_ratio || '1:1', 16);
  if (!channel.resolutions.includes(resolution)) {
    throw channelError('CANVAS_IMAGE2_RESOLUTION_UNSUPPORTED', `${channel.label}不支持 ${resolution.toUpperCase()} 输出`);
  }
  if (!channel.aspectRatios.includes(aspectRatio)) {
    throw channelError('CANVAS_IMAGE2_ASPECT_RATIO_UNSUPPORTED', `${channel.label}不支持 ${aspectRatio} 比例`);
  }
  const outputSize = clean(input.outputSize || input.imageSize, 32);
  const expectedOutputSize = expectedOutputSizeFor(channel, resolution, aspectRatio);
  if (outputSize && outputSize !== expectedOutputSize) {
    throw channelError('CANVAS_IMAGE2_OUTPUT_SIZE_UNSUPPORTED', `${channel.label}不支持 ${outputSize} 输出尺寸`);
  }
  return Object.freeze({
    imageChannel: channel.id,
    imageChannelLabel: channel.label,
    imageProvider: channel.provider,
    generationMode: referenceCount > 0 ? 'reference-image-edit' : 'text-to-image',
    referenceCount,
    resolution,
    aspectRatio,
    outputSize: expectedOutputSize
  });
}

function publicImage2Channel(channel, configured = false) {
  const outputSizes = {...channel.outputSizes};
  for (const [resolution, ratios] of Object.entries(channel.outputSizesByAspectRatio || {})) {
    for (const [ratio, size] of Object.entries(ratios || {})) {
      outputSizes[`${resolution} · ${ratio}`] = size;
    }
  }
  return {
    id: channel.id,
    label: channel.label,
    provider: channel.provider,
    resolutions: [...channel.resolutions],
    aspectRatios: [...channel.aspectRatios],
    outputSizes,
    outputSizesByAspectRatio: JSON.parse(JSON.stringify(channel.outputSizesByAspectRatio || {})),
    submitEnabled: configured === true
  };
}

function publicUnifiedImage2Channel(configured = false) {
  const channel = CHANNELS['openlux-gpt-image-2-c'];
  const outputSizesByAspectRatio = {
    '1k': {...OPENLUX_OUTPUT_SIZES}
  };
  const outputSizes = {'1k': OPENLUX_OUTPUT_SIZES['1:1']};
  for (const [ratio, size] of Object.entries(outputSizesByAspectRatio['1k'])) outputSizes[`1k · ${ratio}`] = size;
  return {
    id: channel.id,
    label: channel.label,
    provider: channel.provider,
    resolutions: ['1k'],
    aspectRatios: [...channel.aspectRatios],
    outputSizes,
    outputSizesByAspectRatio,
    submitEnabled: configured === true,
    supportsTextToImage: true,
    supportsImageToImage: true,
    supportsReferenceImages: true,
    defaultAspectRatio: '1:1',
    defaultImageSize: outputSizesByAspectRatio['1k']['1:1'],
    catalogAspectRatios: COMMON_ASPECT_RATIOS.map(value => ({value, label: value + (channel.aspectRatios.includes(value) ? '' : '（待验证）'), available: channel.aspectRatios.includes(value)})),
    catalogResolutions: COMMON_IMAGE_RESOLUTIONS.map(value => ({value, label:value.toUpperCase() + (value === '1k' ? '' : '（待验证）'), available: value === '1k'})),
    modes: [
      {id: 'text-to-image', label: '文生图', referenceRequired: false, aspectRatios: [...channel.aspectRatios], outputSizesByAspectRatio: JSON.parse(JSON.stringify(channel.outputSizesByAspectRatio)), priceCredits: 10},
      {id: 'reference-image-edit', label: '添加参考图', referenceRequired: true, aspectRatios: [...channel.aspectRatios], outputSizesByAspectRatio: JSON.parse(JSON.stringify(channel.outputSizesByAspectRatio)), priceCredits: 12}
    ],
    priceCredits: 10,
    priceCreditsByMode: {'text-to-image': 10, 'reference-image-edit': 12}
  };
}

function expectedOutputSizeFor(channel, resolution, aspectRatio) {
  return channel.outputSizesByAspectRatio?.[resolution]?.[aspectRatio]
    || channel.outputSizes[resolution]
    || null;
}

module.exports = {CHANNELS, resolveImage2Channel, normalizeImage2Spec, publicImage2Channel, publicUnifiedImage2Channel, expectedOutputSizeFor, OPENLUX_OUTPUT_SIZES};
