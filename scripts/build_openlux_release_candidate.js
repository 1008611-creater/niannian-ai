const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildStage } = require('../build_canonical_release_stage');

const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'niannian-openlux-release-candidate'));
if (fs.existsSync(output)) throw new Error('candidate_output_already_exists');
const result = buildStage(output, {
  release_id: 'niannian-openlux-image2-f03ae99',
  parent_release_id: 'niannian-web-20260804-workbench-clarity-r2-short-drama-modal-fix1',
  scope: 'Migrate canvas Image2 text-to-image and reference-image editing from Yunwu to OpenLux; no production activation performed.',
  allowed_files: [
    'server.js',
    'index.html',
    'app.js',
    'product.css',
    'styles.css',
    'product-system.css',
    'hero-oil-paint.css',
    'sw.js',
    'bridge/niannian_controller_bridge.js',
    'bridge/niannian_canvas_image2_channels.js',
    'bridge/niannian_canvas_image2_node.js',
    'bridge/niannian_canvas_image2_runtime.js',
    'bridge/niannian_canvas_generation_jobs.js',
    'bridge/niannian_canvas_provider_config.js',
    'bridge/niannian_model_control_plane.js',
    'bridge/niannian_openlux_image2_adapter.js',
    'test_canvas_provider_config.js',
    'test_canvas_image2_runtime.js',
    'test_canvas_generation_jobs.js',
    'test_model_control_plane.js',
    'build_canonical_release_stage.js',
    '.gitattributes',
    'PROJECT_MANIFEST.json',
    'release_baseline_attestation_20260818_cross_project_assets.json',
    'release_baseline_review_evidence_20260818_cross_project_assets.json'
  ]
});
process.stdout.write(JSON.stringify(result) + '\n');
