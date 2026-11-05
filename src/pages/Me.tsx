import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../domain/db';
import { r1 } from '../hooks';

export default function Me() {
  const profile = useLiveQuery(() => db.profile.get(1), []);
  const latest = useLiveQuery(async () => (await db.bodyRecords.toArray()).filter((r) => r.isDaily).sort((a, b) => b.date.localeCompare(a.date))[0], []);
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">减脂日记</p><h1>我的</h1></div></div>
      {profile && (
        <div className="card">
          <div className="grid3">
            <div className="stat"><div className="num">{latest ? r1(latest.weightKg) : '-'}</div><div className="lbl">当前体重</div></div>
            <div className="stat"><div className="num">{profile.targetWeightKg ? r1(profile.targetWeightKg) : '-'}</div><div className="lbl">目标体重</div></div>
            <div className="stat"><div className="num">{profile.weeklyRateKg}</div><div className="lbl">kg / 周</div></div>
          </div>
        </div>
      )}
      <div className="card menu">
        <Link to="/me/profile"><span>档案与目标</span><span className="muted">›</span></Link>
        <Link to="/me/period"><span>生理期</span><span className="muted">›</span></Link>
      </div>
      <p className="eyebrow menu-group">饮食</p>
      <div className="card menu">
        <Link to="/me/foods"><span>食物库</span><span className="muted">›</span></Link>
        <Link to="/me/ingredients"><span>有啥吃啥</span><span className="muted">›</span></Link>
      </div>
      <p className="eyebrow menu-group">训练</p>
      <div className="card menu">
        <Link to="/me/schedule"><span>排期设置</span><span className="muted">›</span></Link>
        <Link to="/me/essentials"><span>必练清单</span><span className="muted">›</span></Link>
        <Link to="/me/exercises"><span>动作库</span><span className="muted">›</span></Link>
      </div>
      <div className="card menu">
        <Link to="/me/data"><span>数据与设置</span><span className="muted">›</span></Link>
      </div>
      <p className="muted small center">数据保存在本机 · <Link to="/me/data">备份与恢复</Link></p>
    </>
  );
}
