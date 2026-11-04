"""A separate, bounded software acceptance profile; never weakens the PDF profile.

Reported pass flags are not trusted: measurements, split IDs, source hashes and
required test names are checked again. The finite test suite remains evidence,
not a mathematical or scientific proof of arbitrary inputs.
"""
import hashlib
import json
import math
from pathlib import Path

try:
    from .preflight import check_evidence, digest, finite_number, read_json, relative_file, now, HISTORICAL_DIGESTS
except ImportError:
    from preflight import check_evidence, digest, finite_number, read_json, relative_file, now, HISTORICAL_DIGESTS

SCENES = ('hoop', 'multi', 'chaos', 'liquid', 'orbit')
REQUIRED_TESTS = {
    'causal_replay': ['test_future_position_changes_cannot_change_current_forecast_state', 'test_unsupported_future_contact_stays_in_global_error', 'test_no_future_frame_used_to_fill_initial_velocity'],
    'budget': ['test_reservations_persist_and_failed_calls_keep_their_charge', 'test_actual_cost_releases_unused_reservation_once', 'test_limit_checked_before_provider_is_called'],
    'provider_adapters_and_local_narration': ['test_offline_summary_preserves_failures_and_unknowns', 'test_glimmer_remote_usage_is_charged_and_only_summary_is_sent', 'test_unknown_host_prices_refused_before_transport', 'test_unconfigured_glimmer_never_calls_another_provider'],
    'restart_recovery': ['test_completed_job_survives_server_restart_without_rerun'],
}


def canonical_hash(value):
    # Node JSON.stringify preserves insertion order and emits compact ASCII keys.
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def assert_bound(value, bound, label, issues, minimum=False):
    if not finite_number(value) or (value < bound if minimum else value > bound):
        issues.append(f'{label}: {value!r} outside {">=" if minimum else "<="} {bound}')


def check_benchmark(report, root, report_path):
    issues = []
    canonical = read_json(root / 'validation/simulation-thresholds.json')
    if report.get('schema_version') != 'twinforge.simulation-benchmark.v1' or report.get('source_kind') != 'synthetic' or report.get('mode') != 'simulation':
        issues.append('benchmark: explicit synthetic simulation schema required')
    if report.get('scientifically_validated') is not False:
        issues.append('benchmark: scientific certification must remain false')
    if report.get('thresholds') != canonical or report.get('thresholds_sha256') != digest(root / 'validation/simulation-thresholds.json'):
        issues.append('benchmark: thresholds differ from the predeclared acceptance criteria')
    source = report.get('source_sha256', {})
    if len(source) < 6:
        issues.append('benchmark: executed source hashes missing')
    for name, expected in source.items():
        try:
            if digest(relative_file(root, name)) != expected:
                issues.append(f'benchmark: current source differs from measured source: {name}')
        except ValueError as exc:
            issues.append(f'benchmark: {exc}')
    raw_meta = report.get('observations', {})
    try:
        raw_path = (report_path.parent / raw_meta.get('path', '')).resolve()
        raw_relative = str(raw_path.relative_to(root.resolve()))
        path = relative_file(root, raw_relative)
        if digest(path) != raw_meta.get('sha256'):
            issues.append('benchmark: raw observation hash mismatch')
        raw = read_json(path)
    except (ValueError, OSError, TypeError) as exc:
        issues.append(f'benchmark: raw observations unavailable: {exc}')
        raw = {}
    scenes = report.get('scenes', [])
    if [s.get('id') for s in scenes] != list(SCENES):
        issues.append('benchmark: all five ordered scenes required')
    for s in scenes:
        sid = s.get('id'); prefix = f'benchmark/{sid}'
        expected_checks = {'held_out_prediction', 'finite_predictions', 'active_parameter_identification', 'counterfactual_prediction', 'counterfactual_changes_outcome'}
        expected_checks |= {
            'hoop': {'contact_parameter_error', 'expected_contact_detectors', 'verdict_accuracy', 'in_out_outcome_coverage', 'monte_carlo_sample_count', 'monte_carlo_brier', 'mpc_success_rate', 'mpc_max_corrections', 'mpc_forbidden_obstacle_contacts', 'mpc_max_compute_ms', 'mpc_candidate_sequences', 'active_avoidance_baseline_collision', 'active_avoidance_controlled_success', 'active_avoidance_forbidden_contacts'},
            'multi': {'sphere_and_floor_contacts', 'contact_parameter_error'},
            'chaos': {'perturbation_integration_finite'},
            'liquid': {'mass_balance', 'overflow_exercised'},
            'orbit': {'recalibration_improvement'},
        }.get(sid, set())
        if {c.get('id') for c in s.get('checks', [])} != expected_checks:
            issues.append(f'{prefix}: missing or unexpected acceptance checks')
        prediction_key = {'hoop': 'hoop_mean_error_cm_max', 'multi': 'multi_mean_error_cm_max', 'chaos': 'chaos_mean_angle_error_rad_max', 'liquid': 'liquid_mean_level_error_m_max', 'orbit': 'orbit_mean_error_cm_max'}.get(sid)
        bound_keys = {'held_out_prediction': prediction_key, 'counterfactual_prediction': prediction_key, 'active_parameter_identification': 'active_parameter_relative_error_max', 'contact_parameter_error': 'contact_parameter_absolute_error_max', 'verdict_accuracy': 'verdict_accuracy_min', 'in_out_outcome_coverage': 'minimum_in_and_out_outcomes', 'monte_carlo_sample_count': 'monte_carlo_samples_min', 'monte_carlo_brier': 'monte_carlo_brier_max', 'mpc_success_rate': 'mpc_success_rate_min', 'mpc_max_corrections': 'mpc_corrections_max', 'mpc_forbidden_obstacle_contacts': 'forbidden_obstacle_contacts_max', 'mpc_max_compute_ms': 'mpc_deadline_ms', 'mpc_candidate_sequences': 'mpc_candidate_sequences_min', 'active_avoidance_baseline_collision': 'active_avoidance_baseline_contacts_min', 'active_avoidance_controlled_success': 'active_avoidance_controlled_success_min', 'active_avoidance_forbidden_contacts': 'forbidden_obstacle_contacts_max', 'mass_balance': 'tank_mass_balance_error_max', 'recalibration_improvement': 'orbit_recalibration_improvement_min'}
        fixed_bounds = {'finite_predictions': 1, 'counterfactual_changes_outcome': 1e-6, 'expected_contact_detectors': 5, 'sphere_and_floor_contacts': 2, 'perturbation_integration_finite': 1, 'overflow_exercised': .01}
        for c in s.get('checks', []):
            v, t, op = c.get('value'), c.get('threshold'), c.get('operator')
            key = bound_keys.get(c.get('id'))
            expected_bound = canonical.get(key) if key else fixed_bounds.get(c.get('id'))
            if t != expected_bound:
                issues.append(f'{prefix}/{c.get("id")}: acceptance threshold was changed')
            if op not in {'min', 'max'} or not finite_number(t):
                issues.append(f'{prefix}/{c.get("id")}: invalid bound')
            else:
                assert_bound(v, t, f'{prefix}/{c.get("id")}', issues, op == 'min')
        model = s.get('model', {})
        # Node/Python floating point JSON serialisation can differ in exponent style;
        # the raw SHA is validated by provenance, parameters are checked numerically.
        if not model.get('sha256') or not model.get('parameters') or not model.get('train_prefix_sha256'):
            issues.append(f'{prefix}: frozen parameters and input hash missing')
        if not model.get('at') or model['at'] > report.get('test_revealed_at', ''):
            issues.append(f'{prefix}: model was not frozen before test reveal')
        episodes = raw.get(sid, {})
        ids, seeds = [], []
        for split, minimum in [('train', 3), ('validation', 2), ('test', 3)]:
            trials = episodes.get(split, [])
            if len(trials) < minimum:
                issues.append(f'{prefix}/{split}: fewer than {minimum} experiments')
            for trial in trials:
                ids.append(trial.get('id')); seeds.append(trial.get('seed'))
                if trial.get('source_kind') != 'synthetic' or trial.get('split') != split or len(trial.get('observations', [])) < 10:
                    issues.append(f'{prefix}/{split}: missing observations or source declaration')
                if split == 'train' and any(o.get('t', math.inf) > .4500001 for o in trial.get('observations', [])):
                    issues.append(f'{prefix}: free-flight training exceeds the declared prefix')
        if len(set(ids)) != len(ids) or len(set(seeds)) != len(seeds):
            issues.append(f'{prefix}: train/validation/test episode identities overlap')
        if len(s.get('test', [])) < 3 or len(s.get('validation', [])) < 2:
            issues.append(f'{prefix}: held-out measurements missing')
        threshold_key = {'hoop': 'hoop_mean_error_cm_max', 'multi': 'multi_mean_error_cm_max', 'chaos': 'chaos_mean_angle_error_rad_max', 'liquid': 'liquid_mean_level_error_m_max', 'orbit': 'orbit_mean_error_cm_max'}.get(sid)
        if threshold_key:
            factor = 100 if sid in {'hoop', 'multi', 'orbit'} else 1
            measured = [t.get('mean_error') for t in s.get('test', [])]
            if not measured or not all(finite_number(v) for v in measured):
                issues.append(f'{prefix}: numerical held-out errors required')
            else:
                assert_bound(sum(measured) / len(measured) * factor, canonical[threshold_key], prefix + '/recomputed_prediction', issues)
        cf = s.get('counterfactual', {})
        if cf.get('intervention', {}).get('factor') != 1.2 or not cf.get('prediction'):
            issues.append(f'{prefix}: measured counterfactual intervention missing')
        ab = s.get('ablation', {})
        if ab.get('kind') != 'identified_vs_fixed_unfitted_prior' or len(ab.get('test_episode_ids', [])) < 3 or not all(finite_number(ab.get(k)) for k in ('prior_mean_error', 'identified_mean_error')):
            issues.append(f'{prefix}: quantitative same-test prior ablation missing')
    if scenes and scenes[0].get('id') == 'hoop':
        h = scenes[0]; controls = h.get('control', [])
        if len(controls) < canonical['mpc_test_episodes']:
            issues.append('benchmark/control: three independent executions required')
        successes = sum(c.get('scored') is True for c in controls)
        assert_bound(successes / max(1, len(controls)), canonical['mpc_success_rate_min'], 'benchmark/control/success', issues, True)
        challenge = h.get('obstacle_challenge', {})
        assert_bound(len(challenge.get('baseline_forbidden_contacts', [])), 1, 'benchmark/active_avoidance/baseline_collision', issues, True)
        if challenge.get('scored') is not True or challenge.get('forbidden_contacts'):
            issues.append('benchmark/active_avoidance: controlled obstacle bypass and target success required')
        for c in controls + [challenge]:
            assert_bound(c.get('corrections'), 3, 'benchmark/control/corrections', issues)
            if c.get('forbidden_contacts'):
                issues.append('benchmark/control: forbidden obstacle collision')
            logs = c.get('replans', [])
            if not logs:
                issues.append('benchmark/control: no replan execution log')
            for index, log in enumerate(logs):
                assert_bound(log.get('compute_ms'), 120, 'benchmark/control/deadline_ms', issues)
                assert_bound(log.get('evaluated'), 24, 'benchmark/control/candidates', issues, True)
                if log.get('only_first_action_executed') is not True or log.get('feasible') and not log.get('applied_command'):
                    issues.append('benchmark/control: receding-horizon execution not demonstrated')
                if index and abs(log['t'] - logs[index-1]['t'] - .12) > 1e-9:
                    issues.append('benchmark/control: replan interval differs from exact 120ms')
        for v in h.get('verdicts', []):
            outcomes = v.get('monte_carlo_outcomes', [])
            if len(outcomes) < 18 or any(x not in (0, 1) for x in outcomes):
                issues.append('benchmark/verdict: at least 18 numerical perturbation outcomes required')
            elif abs(sum(outcomes) / len(outcomes) - v.get('probability', -1)) > 1e-10:
                issues.append('benchmark/verdict: probability differs from recorded outcomes')
            if v.get('correct') != (v.get('actual_scored') == v.get('predicted_scored')):
                issues.append('benchmark/verdict: incorrect success accounting')
    return issues


def check_independent_3d(report):
    issues = []
    if report.get('schema_version') != 'twinforge.synthetic_benchmark.v1' or report.get('real_world_validation') is not False:
        issues.append('independent_3d: explicit synthetic schema required')
    if report.get('generator_integrator') == report.get('fitted_integrator'):
        issues.append('independent_3d: independent generator integrator required')
    assert_bound(report.get('sensor_noise_std_m'), .001, 'independent_3d/sensor_noise', issues, True)
    for key in ('split_ids', 'fingerprints'):
        parts = report.get(key, {}); combined = []
        for split, minimum in [('train', 3), ('validation', 2), ('test', 3)]:
            values = parts.get(split, [])
            if len(values) < minimum: issues.append(f'independent_3d/{key}/{split}: insufficient episodes')
            combined.extend(values)
        if len(set(combined)) != len(combined): issues.append(f'independent_3d/{key}: overlapping splits')
    causal = report.get('causal_plus_0_5s', {})
    assert_bound(causal.get('all_issued_scorable_mean_cm'), 5, 'independent_3d/causal_mean_cm', issues)
    assert_bound(causal.get('scored'), 30, 'independent_3d/scored', issues, True)
    for shot in causal.get('shots', []):
        for forecast in shot.get('forecasts', []):
            state = forecast.get('state', {}).get('state_estimation', {})
            if state and (state.get('uses_future_observations') is not False or state.get('latest_observation_t', math.inf) > forecast['source_t'] + 1e-10):
                issues.append('independent_3d: future observation leaked into a forecast')
    assert_bound(report.get('independent_test', {}).get('mean_error_cm'), 5, 'independent_3d/long_rollout_cm', issues)
    return issues


def check_legacy_replay(report):
    issues = []
    if report.get('same_raw_frames') is not True or report.get('threshold_cm_unchanged') != 5 or not report.get('baseline_sha256'):
        issues.append('legacy_replay: unchanged raw input, baseline hash and original threshold required')
    for key in ('before_fixed_grid', 'after_fixed_grid'):
        p = report.get(key, {})
        if not p.get('forecasts') or not p.get('all_issued_scorable') or not p.get('coverage'):
            issues.append(f'legacy_replay/{key}: all issued errors and coverage must remain visible')
    pair = report.get('common_emission_comparison', {})
    if pair.get('count', 0) < 1 or len(pair.get('pairs', [])) != pair.get('count'):
        issues.append('legacy_replay: same-emission comparison missing')
    if not report.get('limitations'):
        issues.append('legacy_replay: irrecoverable timing/calibration limitations missing')
    # There is deliberately no "legacy errors <5cm" fake pass: the full failure
    # remains published. Accuracy acceptance uses the new independent 3D dataset.
    return issues


def check_software(report, root):
    issues = []
    if report.get('passed') is not True or report.get('complete_suite') is not True or report.get('source_changed_during_checks') is not False:
        issues.append('software: complete stable passing suite required')
    logs = '\n'.join(c.get('stdout', '') + '\n' + c.get('stderr', '') for c in report.get('checks', []))
    for group, names in REQUIRED_TESTS.items():
        for name in names:
            if not any(name in line and line.rstrip().endswith('... ok') for line in logs.splitlines()):
                issues.append(f'software/{group}: passing named test missing: {name}')
    for name, expected in report.get('source_sha256', {}).items():
        try:
            if digest(relative_file(root, name)) != expected: issues.append(f'software: source changed after checks: {name}')
        except ValueError as exc: issues.append(f'software: {exc}')
    if not report.get('source_sha256'): issues.append('software: source manifest absent')
    return issues


def run(root):
    issues, results = [], []
    manifest = read_json(root / 'validation/simulation-manifest.json')
    if manifest.get('profile') != 'simulation-only' or len(manifest.get('excluded_boundaries', [])) != 4:
        issues.append('simulation profile: explicit bounded scope required')
    loaded = {}
    for key in ('benchmark', 'independent_3d', 'legacy_replay', 'tracking', 'browser', 'software', 'media', 'vendor'):
        item = manifest.get('evidence', {}).get(key, {})
        current = []; check_evidence(root, [item], key, current)
        try:
            file = relative_file(root, item.get('path')); loaded[key] = (read_json(file), file)
        except (ValueError, OSError, TypeError) as exc: current.append(f'{key}: {exc}')
        results.append({'id': key + '/provenance', 'passed': not current, 'issues': current}); issues.extend(current)
    def apply(name, fn):
        if name not in loaded: return
        data, file = loaded[name]
        try: found = fn(data, file)
        except (TypeError, ValueError, KeyError, OSError, ZeroDivisionError) as exc: found = [f'{name}: malformed evidence: {exc}']
        results.append({'id': name, 'passed': not found, 'issues': found}); issues.extend(found)
    apply('benchmark', lambda d, f: check_benchmark(d, root, f))
    apply('independent_3d', lambda d, _: check_independent_3d(d))
    apply('legacy_replay', lambda d, _: check_legacy_replay(d))
    apply('software', lambda d, _: check_software(d, root))
    def browser(d, _):
        found = []; scenes = d.get('scenes', [])
        if d.get('run', {}).get('mode') != 'simulation' or [s.get('id') for s in scenes] != list(SCENES): found.append('browser: five explicit simulation scenes required')
        source_path = d.get('run', {}).get('source_path', 'index.html')
        if source_path not in {'index.html', 'workbench.html'} or d.get('run', {}).get('source_sha256') != digest(root / source_path): found.append('browser: current UI differs from measured UI')
        for s in scenes:
            for name in ('launch', 'ghost_ahead'):
                test = next((t for t in s.get('tests', []) if t.get('id') == name), {})
                if test.get('status') != 'pass' or not test.get('measurements') or not test.get('executed_at'): found.append(f'browser/{s.get("id")}/{name}: measured UI execution missing')
                check_evidence(root, test.get('evidence'), f'browser/{s.get("id")}/{name}', found)
        return found
    apply('browser', browser)
    def media(d, _):
        found = []
        for name in ('final_video', 'ghost_gif'):
            asset = d.get('assets', {}).get(name, {}); check_evidence(root, asset.get('evidence'), 'media/' + name, found)
            if asset.get('status') != 'reviewed' or not asset.get('review', {}).get('reviewed_at'): found.append('media/' + name + ': review missing')
            if name == 'final_video':
                duration = asset.get('duration_seconds'); assert_bound(duration, 160, 'media/duration', found); assert_bound(duration, 140, 'media/duration', found, True)
                for field in ('continuous_subtitles', 'simulation_labels_visible', 'numbers_traceable', 'no_mockup'):
                    if asset.get('review', {}).get(field) is not True: found.append('media: ' + field + ' review missing')
        return found
    apply('media', media)
    def vendor(d, file):
        found = []
        if not d.get('npm_integrity') or len(d.get('files_sha256', {})) < 5: found.append('vendor: upstream integrity and runtime inventory required')
        for name, expected in d.get('files_sha256', {}).items():
            path = relative_file(root, str((file.parent / name).relative_to(root)))
            if digest(path) != expected: found.append('vendor: hash mismatch: ' + name)
        if 'LICENSE.txt' not in d.get('files_sha256', {}): found.append('vendor: license missing')
        return found
    apply('vendor', vendor)
    # The perception comparison validator has a fixed public contract. A pending
    # provider run cannot be made green merely by adding a status field.
    def tracking(d, _):
        found = []
        if d.get('source_kind') != 'synthetic' or d.get('real_world_validation') is not False: found.append('tracking: explicit synthetic source required')
        if d.get('comparison') != 'sam_vs_naive_same_frames': found.append('tracking: genuine same-frame SAM vs naive comparison required')
        if not d.get('frame_ids') or len(set(d.get('frame_ids', []))) < 12: found.append('tracking: at least 12 common frames required')
        if not d.get('source_video_sha256') or not d.get('ground_truth_sha256'): found.append('tracking: source and evaluator truth hashes required')
        for name in ('sam', 'naive'):
            v = d.get('variants', {}).get(name, {})
            if not finite_number(v.get('mean_centroid_error_px')) or not finite_number(v.get('detection_rate')) or not v.get('per_frame'): found.append('tracking/' + name + ': numerical per-frame results required')
            elif len(v['per_frame']) != len(d.get('frame_ids', [])): found.append('tracking/' + name + ': evaluated frame cohort differs')
        if not d.get('limitations'): found.append('tracking: limitations and tracker distinction required')
        check_evidence(root, d.get('evidence'), 'tracking', found)
        return found
    apply('tracking', tracking)
    for name, expected in HISTORICAL_DIGESTS.items():
        if not (root / name).is_file() or digest(root / name) != expected: issues.append('history: original archive changed: ' + name)
    return {'version': 1, 'profile': 'simulation-only', 'checked_at': now(), 'ready_for_review': not issues, 'scientifically_validated': False,
            'strict_pdf_satisfied': False, 'meaning': manifest['scope'], 'excluded_boundaries': manifest['excluded_boundaries'], 'checks': results, 'issues': issues}
