import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import NavIcon from './components/NavIcon';
import { db, ensureSeeded } from './domain/db';
import DataSettings from './pages/DataSettings';
import EssentialsSettings from './pages/EssentialsSettings';
import ExerciseLibrary from './pages/ExerciseLibrary';
import FoodLibrary from './pages/FoodLibrary';
import History from './pages/History';
import Ingredients from './pages/Ingredients';
import Me from './pages/Me';
import MealEdit from './pages/MealEdit';
import Onboarding from './pages/Onboarding';
import Period from './pages/Period';
import Profile from './pages/Profile';
import ScheduleSettings from './pages/ScheduleSettings';
import AskAi from './pages/AskAi';
import Today from './pages/Today';
import Trends from './pages/Trends';

const TABS = [
  { to: '/', label: '今日', icon: 'today' },
  { to: '/trends', label: '趋势', icon: 'trends' },
  { to: '/me', label: '我的', icon: 'me' },
] as const;

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    ensureSeeded().then(() => setReady(true));
  }, []);
  const settings = useLiveQuery(() => db.settings.get(1), [], undefined);
  const loc = useLocation();
  if (!ready || settings === undefined) return <main className="center muted">加载中…</main>;
  if (!settings?.onboarded && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  // 两个方向的跳转使用同一次查询结果，避免保存后被尚未刷新的状态退回录入页。
  if (settings.onboarded && loc.pathname === '/onboarding') return <Navigate to="/" replace />;

  const showTabs = ['/', '/trends', '/me'].includes(loc.pathname);
  return (
    <>
      <main>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<Today />} />
          <Route path="/meal/:date/:slot" element={<MealEdit />} />
          <Route path="/ask" element={<AskAi />} />
          <Route path="/history" element={<History />} />
          {/* 运动打卡已并入今日页，旧地址保留跳转 */}
          <Route path="/workout" element={<Navigate to="/" replace />} />
          <Route path="/workout/schedule" element={<Navigate to="/me/schedule" replace />} />
          <Route path="/workout/exercises" element={<Navigate to="/me/exercises" replace />} />
          <Route path="/workout/essentials" element={<Navigate to="/me/essentials" replace />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/me" element={<Me />} />
          <Route path="/me/profile" element={<Profile />} />
          <Route path="/me/period" element={<Period />} />
          <Route path="/me/foods" element={<FoodLibrary />} />
          <Route path="/me/ingredients" element={<Ingredients />} />
          <Route path="/me/shopping" element={<Navigate to="/me/ingredients" replace />} />
          <Route path="/me/schedule" element={<ScheduleSettings />} />
          <Route path="/me/essentials" element={<EssentialsSettings />} />
          <Route path="/me/exercises" element={<ExerciseLibrary />} />
          <Route path="/me/data" element={<DataSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {showTabs && (
        <nav className="tabs" aria-label="主导航">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico"><NavIcon name={t.icon} /></span>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}
