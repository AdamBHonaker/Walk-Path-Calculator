import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadDailyGoal, saveDailyGoal,
  loadStoredHeightFt, saveStoredHeightFt,
  loadStoredHeightIn, saveStoredHeightIn,
  loadStoredWeightKg, saveStoredWeightKg,
  loadStoredPace, saveStoredPace,
  loadAccessPrefs, saveAccessPrefs,
  loadMobilityProfile, saveMobilityProfile,
} from "../lib/personaPrefs.js";

export function usePersonalization(initialUrlParams) {
  const initialAccessRef = useRef(null);
  if (initialAccessRef.current === null) initialAccessRef.current = loadAccessPrefs();
  const initialAccess = initialAccessRef.current;

  // `hft`/`hin` are an atomic pair — a well-formed share link carries both or
  // neither. Adopt the URL height only when both are present; a lone or
  // invalid param must not partially override (or, via the mount-time
  // save effect below, wipe) the visitor's own saved height.
  const urlHasHeight = initialUrlParams.hft != null && initialUrlParams.hin != null;
  const [heightFt, setHeightFt] = useState(() =>
    urlHasHeight ? initialUrlParams.hft : loadStoredHeightFt(),
  );
  const [heightIn, setHeightIn] = useState(() =>
    urlHasHeight ? initialUrlParams.hin : loadStoredHeightIn(),
  );
  const [weightKg, setWeightKg] = useState(loadStoredWeightKg);
  const [dailyGoal, setDailyGoalState] = useState(() => loadDailyGoal());
  const [walkPace, setWalkPace] = useState(loadStoredPace);

  const [avoidStairs, setAvoidStairs] = useState(initialAccess.avoidStairs);
  const [preferPedestrian, setPreferPedestrian] = useState(initialAccess.preferPedestrian);
  const [mobilityProfile, setMobilityProfileState] = useState(loadMobilityProfile);

  const setMobilityProfile = useCallback((next) => {
    const value = next === "wheeled" ? "wheeled" : "walking";
    setMobilityProfileState(value);
    saveMobilityProfile(value);
  }, []);

  // OPT-076: coalesced persistence. The prior five separate effects each
  // re-ran on every state-update batch — touching height + weight in the
  // same Personalize modal commit fired two effects → two localStorage
  // writes → two synchronous JSON.stringify + setItem round-trips. One
  // effect with all five deps runs once per batch (React coalesces
  // setState updates within the same event loop tick), so a multi-field
  // commit is one set of writes. Each save helper still touches its own
  // key, so the on-disk shape is unchanged; only the round-trip count
  // collapses. `saveAccessPrefs` writes the avoid/prefer pair as one
  // merged object the way it already did, so that path stays atomic too.
  useEffect(() => {
    saveStoredPace(walkPace);
    saveStoredHeightFt(heightFt);
    saveStoredHeightIn(heightIn);
    saveStoredWeightKg(weightKg);
    saveAccessPrefs({ avoidStairs, preferPedestrian });
  }, [walkPace, heightFt, heightIn, weightKg, avoidStairs, preferPedestrian]);

  const handleHeightChange = useCallback((ft, inches) => {
    const toNum = v => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    setHeightFt(toNum(ft));
    setHeightIn(toNum(inches));
  }, []);

  const handleWeightChange = useCallback((kg) => {
    setWeightKg(kg);
  }, []);

  const handleGoalChange = useCallback((val) => {
    setDailyGoalState(val);
    saveDailyGoal(val);
  }, []);

  return {
    heightFt, heightIn, weightKg, dailyGoal, walkPace,
    avoidStairs, preferPedestrian, mobilityProfile,
    setWalkPace, setAvoidStairs, setPreferPedestrian, setMobilityProfile,
    handleHeightChange, handleWeightChange, handleGoalChange,
  };
}
