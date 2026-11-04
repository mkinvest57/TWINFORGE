import copy
import unittest

from validation.simulation_profile import check_independent_3d, check_legacy_replay


class SimulationEvidenceTests(unittest.TestCase):
    def independent(self):
        return {'schema_version': 'twinforge.synthetic_benchmark.v1', 'real_world_validation': False,
                'generator_integrator': 'RK4', 'fitted_integrator': 'Euler', 'sensor_noise_std_m': .002,
                'split_ids': {'train': ['a', 'b', 'c'], 'validation': ['d', 'e'], 'test': ['f', 'g', 'h']},
                'fingerprints': {'train': ['a1', 'b1', 'c1'], 'validation': ['d1', 'e1'], 'test': ['f1', 'g1', 'h1']},
                'independent_test': {'mean_error_cm': 2},
                'causal_plus_0_5s': {'all_issued_scorable_mean_cm': 1, 'scored': 30,
                    'shots': [{'forecasts': [{'source_t': .2, 'state': {'state_estimation': {'uses_future_observations': False, 'latest_observation_t': .2}}}]}]}}

    def test_pass_flag_cannot_override_failed_accuracy(self):
        report = self.independent(); report['passed'] = True
        report['causal_plus_0_5s']['all_issued_scorable_mean_cm'] = 46.7
        self.assertTrue(any('causal_mean' in issue for issue in check_independent_3d(report)))

    def test_overlap_is_rejected_even_with_good_scores(self):
        report = self.independent(); report['fingerprints']['test'][0] = 'a1'
        self.assertTrue(any('overlapping' in issue for issue in check_independent_3d(report)))

    def test_future_observation_leak_cannot_claim_causal_forecast(self):
        report = self.independent()
        report['causal_plus_0_5s']['shots'][0]['forecasts'][0]['state']['state_estimation']['latest_observation_t'] = .7
        self.assertTrue(any('future' in issue for issue in check_independent_3d(report)))

    def test_nonfinite_accuracy_rejected(self):
        report = self.independent(); report['independent_test']['mean_error_cm'] = float('nan')
        self.assertTrue(check_independent_3d(report))

    def test_legacy_supported_only_score_cannot_hide_global_failure(self):
        report = {'same_raw_frames': True, 'threshold_cm_unchanged': 5, 'baseline_sha256': 'a' * 64,
                  'before_fixed_grid': {'forecasts': [1], 'coverage': {'issued': .5}, 'supported': {'mean_cm': 2}},
                  'after_fixed_grid': {'forecasts': [1], 'coverage': {'issued': .5}, 'supported': {'mean_cm': 1}},
                  'common_emission_comparison': {'count': 1, 'pairs': [1]}, 'limitations': ['Legacy timestamps cannot be repaired.']}
        self.assertTrue(any('all issued errors' in issue for issue in check_legacy_replay(report)))

    def test_legacy_bad_accuracy_is_preserved_as_disclosure_not_fake_accuracy_pass(self):
        report = {'same_raw_frames': True, 'threshold_cm_unchanged': 5, 'baseline_sha256': 'a' * 64,
                  'before_fixed_grid': {'forecasts': [1], 'coverage': {'issued': .5}, 'all_issued_scorable': {'mean_cm': 46.7}},
                  'after_fixed_grid': {'forecasts': [1], 'coverage': {'issued': .5}, 'all_issued_scorable': {'mean_cm': 39.16}},
                  'common_emission_comparison': {'count': 1, 'pairs': [1]}, 'limitations': ['Legacy timestamps cannot be repaired.']}
        self.assertEqual(check_legacy_replay(report), [])


if __name__ == '__main__':
    unittest.main()
