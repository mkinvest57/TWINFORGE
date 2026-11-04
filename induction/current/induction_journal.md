# L3 calibration correction on unchanged historical observations

Known quadratic-drag family; trained on the original recorded positions. No independent test result is claimed.

{
  "fit": {
    "initial_acceleration_residual_rms": 1.3805067737826178,
    "acceleration_residual_rms": 1.3805067737826178,
    "n_points": 9,
    "drag_boundary_zero": false,
    "trajectory_refinement": {
      "status": "refined_on_training_observations",
      "method": "bounded_LM_integrated_positions_with_training_Huber_weights",
      "initial_position_rmse_cm": 7.175030996441648,
      "final_position_rmse_cm": 1.275971563385719,
      "segments": 1,
      "positions": 11,
      "integrator_step_s": 0.002,
      "uncertainty": "approximate local least-squares; calibration systematic error not included",
      "iterations": [
        {
          "iteration": 1,
          "accepted": true,
          "train_position_rmse_cm": 1.6257711313966896
        },
        {
          "iteration": 2,
          "accepted": true,
          "train_position_rmse_cm": 1.2766463922524225
        },
        {
          "iteration": 3,
          "accepted": false,
          "train_position_rmse_cm": 1.2766463922524225
        },
        {
          "iteration": 4,
          "accepted": false,
          "train_position_rmse_cm": 1.2766463922524225
        },
        {
          "iteration": 5,
          "accepted": false,
          "train_position_rmse_cm": 1.2766463922524225
        },
        {
          "iteration": 6,
          "accepted": false,
          "train_position_rmse_cm": 1.2766463922524225
        },
        {
          "iteration": 7,
          "accepted": true,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 8,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 9,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 10,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 11,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 12,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 13,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 14,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 15,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 16,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 17,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        },
        {
          "iteration": 18,
          "accepted": false,
          "train_position_rmse_cm": 1.275971563385719
        }
      ],
      "uses_validation_or_test": false
    }
  },
  "parameters": {
    "g": {
      "value": 10.725207356878874,
      "uncertainty": 0.13347601895966651,
      "source": "training observations only; initialized by finite differences, refined by integrated trajectory residuals; contacts/outliers excluded",
      "status": "estimated",
      "units": "m/s^2"
    },
    "drag": {
      "value": 0.34395040911278807,
      "uncertainty": 0.03354194574747311,
      "source": "training observations only; initialized by finite differences, refined by integrated trajectory residuals; contacts/outliers excluded",
      "status": "estimated",
      "units": "1/m"
    },
    "wind": {
      "value": [
        0.6453121223907752,
        0.0,
        0.0
      ],
      "uncertainty": [
        0.3535937539674211,
        null,
        null
      ],
      "source": "training observations only; initialized by finite differences, refined by integrated trajectory residuals; contacts/outliers excluded; vertical acceleration absorbed by g",
      "status": "estimated",
      "units": "m/s^2"
    },
    "restitution": {
      "value": null,
      "uncertainty": null,
      "source": "no universal material coefficient; see per-surface measurements",
      "status": "unobserved",
      "units": "ratio"
    },
    "friction": {
      "value": null,
      "uncertainty": null,
      "source": "no independent rolling/sliding observations fitted",
      "status": "unobserved",
      "units": "ratio"
    },
    "magnus": {
      "value": null,
      "uncertainty": null,
      "source": "spin-induced lift not identifiable without measured spin",
      "status": "unobserved",
      "units": null
    },
    "spin": {
      "value": null,
      "uncertainty": null,
      "source": "ball spin not reconstructed from a silhouette",
      "status": "unobserved",
      "units": "rad/s"
    }
  },
  "replay_all": {
    "count": 7,
    "mean_cm": 39.16485301616385,
    "max_cm": 85.05628437317839
  },
  "replay_supported": {
    "count": 2,
    "mean_cm": 3.7884395589972724,
    "max_cm": 5.354109912708749
  },
  "coverage": {
    "issued_over_scheduled": 0.22580645161290322,
    "supported_over_scheduled": 0.06451612903225806,
    "supported_over_issued": 0.2857142857142857
  }
}

See replay_diagnostic.json for every issued prediction, unsupported target and rejection. Legacy timing/scale limitations remain.
