// Shared small helpers used by several screens (moved out of App.tsx in V1.9).
import { Pagination } from '../api';
import { L } from './labels';

export const currency=(v:any)=>`₹${Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const monthName=(m:number)=>m?new Date(2000,m-1,1).toLocaleString('en-IN',{month:'long'}):'—';
export const errMessage=(e:unknown)=>e instanceof Error?e.message:'Something went wrong';
export function PaginationControls({pagination,onChange}:{pagination?:Pagination;onChange:(page:number)=>void}){if(!pagination||pagination.total===0)return null;return <div className="pagination"><span>Showing {Math.min((pagination.page-1)*pagination.pageSize+1,pagination.total)}–{Math.min(pagination.page*pagination.pageSize,pagination.total)} of {pagination.total}</span><div className="actions"><button disabled={pagination.page<=1} onClick={()=>onChange(pagination.page-1)}>{L('btn.previous')}</button><span>Page {pagination.page}/{Math.max(1,pagination.totalPages)}</span><button disabled={pagination.page>=pagination.totalPages} onClick={()=>onChange(pagination.page+1)}>{L('btn.next')}</button></div></div>}
export function PageSize({value,onChange}:{value:number;onChange:(v:number)=>void}){return <select className="page-size" value={value} onChange={e=>onChange(Number(e.target.value))}><option>10</option><option>25</option><option>50</option><option>100</option></select>}
