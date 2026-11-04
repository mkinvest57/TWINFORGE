import base64
import io
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from twinforge_runtime.synthetic_capture import build_capture


class SyntheticCaptureValidationTests(unittest.TestCase):
    def fixture(self):
        out = io.BytesIO()
        Image.new('RGB', (640, 480)).save(out, format='PNG')
        png = 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()
        return {'schema_version': 'twinforge.synthetic-capture.v1', 'capture_id': 'test-capture',
                'fps': 12, 'width': 640, 'height': 480,
                'frames': [{'frame_index': i, 't': i/12, 'png': png} for i in range(36)],
                'calibration': {'mode': 'sphere_size', 'camera_matrix': [[500,0,320],[0,500,240],[0,0,1]],
                    'camera_to_world_rotation': [[1,0,0],[0,1,0],[0,0,1]],
                    'camera_to_world_translation_m': [0,0,0], 'ball_diameter_m': .24, 'diameter_uncertainty_m': 0}}

    def test_invalid_time_or_path_rejected_before_files_or_encoder(self):
        with tempfile.TemporaryDirectory() as folder:
            for corruption in ('path', 'time', 'dimensions'):
                body = self.fixture()
                if corruption == 'path': body['capture_id'] = '../../public-truth'
                elif corruption == 'time': body['frames'][15]['t'] += .03
                else: body['width'] = 1280
                with self.assertRaises(ValueError):
                    build_capture(body, Path(folder), Path(folder))
                self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
