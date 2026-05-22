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

  useEffect(() => {
    saveAccessPrefs({ avoidStairs, preferPedestrian });
  }, [avoidStairs, preferPedestrian]);

  const setMobilityProfile = useCallback((next) => {
    const value = next === "wheeled" ? "wheeled" : "walking";
    setMobilityProfileState(value);
    saveMobilityProfile(value);
  }, []);

  useEffect(() => { saveStoredPace(walkPace); }, [walkPace]);
  useEffect(() => { saveStoredHeightFt(heightFt); }, [heightFt]);
  useEffect(() => { saveStoredHeightIn(heightIn); }, [heightIn]);
  useEffect(() => { saveStoredWeightKg(weightKg); }, [weightKg]);

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
