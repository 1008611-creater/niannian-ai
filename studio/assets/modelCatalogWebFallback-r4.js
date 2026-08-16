const CATALOG_ENDPOINT = "/api/canvas/model-catalog";

async function readCatalog() {
  const response = await fetch(CATALOG_ENDPOINT, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`model catalog ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.catalog?.models) ? payload.catalog.models : [];
}

function kindOf(model) {
  return String(model?.kind || model?.type || "").trim().toLowerCase();
}

function option(value, label) {
  const normalized = String(value || "").trim();
  return normalized ? { value: normalized, label: label || normalized } : null;
}

function generationOptions(model, normalized) {
  const rawResolutions = model?.resolutions || model?.supportedResolutions || [];
  const rawRatios = model?.aspectRatios || model?.supportedAspectRatios || [];
  const resolutions = Array.isArray(rawResolutions)
    ? rawResolutions.map((value) => option(value, String(value).toUpperCase())).filter(Boolean)
    : [];
  const ratios = Array.isArray(rawRatios)
    ? rawRatios.map((value) => option(value)).filter(Boolean)
    : [];
  const outputSizes = model?.outputSizes && typeof model.outputSizes === "object" ? model.outputSizes : {};
  const imageSizes = Object.entries(outputSizes).map(([resolution, size]) => option(size, `${size}（${String(resolution).toUpperCase()}）`)).filter(Boolean);
  if (normalized === "image") {
    return {
      imageOptions: {
        aspectRatioOptions: ratios,
        imageSizeOptions: imageSizes,
        resolutionOptions: resolutions,
        defaultAspectRatio: ratios[0]?.value,
        defaultImageSize: imageSizes[0]?.value,
        defaultResolution: resolutions[0]?.value,
        controls: [
          { key: "aspect_ratio", label: "比例", binding: "aspectRatio", optionSource: "aspectRatioOptions" },
          { key: "outputSize", label: "大小", binding: "imageSize", optionSource: "imageSizeOptions" },
          { key: "resolution", label: "清晰度", binding: "resolution", optionSource: "resolutionOptions" }
        ]
      }
    };
  }
  if (normalized === "video") {
    const configured = model?.videoOptions && typeof model.videoOptions === "object" ? model.videoOptions : null;
    return {
      videoOptions: {
        sizeOptions: configured?.sizeOptions || ratios,
        durationOptions: configured?.durationOptions || [],
        resolutionOptions: configured?.resolutionOptions || resolutions,
        defaultDurationSeconds: configured?.defaultDurationSeconds,
        defaultSize: configured?.defaultSize || ratios[0]?.value,
        defaultResolution: configured?.defaultResolution || resolutions[0]?.value,
        controls: configured?.controls || [
          { key: "aspect_ratio", label: "比例", binding: "size", optionSource: "sizeOptions" },
          { key: "resolution", label: "大小", binding: "resolution", optionSource: "resolutionOptions" }
        ]
      }
    };
  }
  return {};
}

export async function webCatalogModels(kind) {
  const normalized = kind === "imageEdit" ? "image" : kind;
  const models = await readCatalog();
  return models
    .filter((model) => {
      const modelKind = kindOf(model);
      return model?.enabled !== false && (normalized === "image"
        ? modelKind === "image" || modelKind === "image_edit" || modelKind === "image-edit"
        : modelKind === normalized);
    })
    .map((model) => {
      const modelKey = String(model?.id || model?.modelKey || model?.model || "").trim();
      const modelAlias = String(model?.alias || model?.modelAlias || modelKey).trim();
      const labelZh = String(model?.label || model?.labelZh || model?.name || modelAlias || modelKey).trim();
      const vendorKey = String(model?.providerId || model?.providerKey || model?.provider || model?.vendorKey || "").trim();
      return {
        modelKey: modelKey || modelAlias,
        modelAlias: modelAlias || modelKey,
        labelZh,
        vendorKey: vendorKey || undefined,
        pricing: {
          cost: Number(model?.priceCredits ?? model?.cost ?? 0) || 0,
          enabled: model?.enabled !== false,
        },
        ...(modelKey === "minimax-h3" ? {
          modes: Array.isArray(model?.videoModes) ? model.videoModes.map((mode) => ({ id: mode.id, labelZh: mode.label, transportTaskKind: "text_to_video", meta: { referenceContract: mode.referenceContract || {} } })) : []
        } : {}),
        meta: {
          transportTaskKind: normalized === "video" ? "text_to_video" : normalized === "image" ? "image_generation" : undefined,
          ...(modelKey === "minimax-h3" ? { archetype: { id: "minimax-h3", modeId: "t2v" }, h3Modes: model?.videoModes || [] } : {}),
          supportedResolutions: model?.resolutions || model?.supportedResolutions || [],
          supportedAspectRatios: model?.aspectRatios || model?.supportedAspectRatios || [],
          outputSizes: model?.outputSizes || {},
          ...generationOptions(model, normalized),
        },
      };
    });
}

export async function webCatalogHealth() {
  const models = await readCatalog();
  return {
    byKind: ["text", "image", "video"].map((kind) => ({
      kind,
      enabledModels: models.filter((model) => model?.enabled !== false && kindOf(model) === kind).length,
    })),
    issues: [],
  };
}

export async function webCatalogVendors() {
  const models = await readCatalog();
  const vendors = new Map();
  for (const model of models) {
    const key = String(model?.providerId || model?.providerKey || model?.provider || model?.vendorKey || "").trim().toLowerCase();
    const name = String(model?.providerLabel || model?.providerName || key).trim();
    if (key) vendors.set(key, name || key);
  }
  return [...vendors].map(([key, name]) => ({ key, name, enabled: true, authType: "none", hasApiKey: true }));
}
