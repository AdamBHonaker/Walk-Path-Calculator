import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadDailyGoal, saveDailyGoal,
  loadStoredHeightFt, saveStoredHeightFt,
  loadStoredHeightIn, saveStoredHeightIn,
  loadStoredWeightKg, saveStoredWeightKg,
  loadStoredPace, saveStoredPace,
  loadAccessPrefs, saveAccessPrefs,
} from "../lib/personaPrefs.js";

export function usePersonalization(initialUrlParams) {
  const initialAccessRef = useRef(null);
  if (initialAccessRef.current === null) initialAccessRef.current = loadAccessPrefs();
  const initialAccess = initialAccessRef.current;

  const [heightFt, setHeightFt] = useState(() =>
    initialUrlParams.hft ?? loadStoredHeightFt(),
  );
  const [heightIn, setHeightIn] = useState(() => {
    if (initialUrlParams.hft != null) return initialUrlParams.hin;
    return loadStoredHeightIn();
  });
  const [weightKg, setWeightKg] = useState(loadStoredWeightKg);
  const [dailyGoal, setDailyGoalState] = useState(() => loadDailyGoal());
  const [walkPace, setWalkPace] = useState(loadStoredPace);

  const [avoidStairs, setAvoidStairs] = useState(initialAccess.avoidStairs);
  const [preferPedestrian, setPreferPedestrian] = useState(initialAccess.preferPedestrian);

  useEffect(() => {
    saveAccessPrefs({ avoidStairs, preferPedestrian });
  }, [avoidStairs, preferPedestrian]);

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
    avoidStairs, preferPedestrian,
    setWalkPace, setAvoidStairs, setPreferPedestrian,
    handleHeightChange, handleWeightChange, handleGoalChange,
  };
}
