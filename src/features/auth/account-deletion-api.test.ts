import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createMobileAuthApi } from "./mobile-api";
import { createEmailOtpContextCodec } from "./email-otp-context";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const secret = "synthetic-deletion-secret-at-least-32-characters";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email: "student@wisc.edu", exp: Math.floor(Date.now()/1000)+3600 })}.synthetic`;

describe("永久注销 HTTP（真实 SDK、模拟网络；SQL 删除／权限另验）", () => {
  let completed: boolean;
  let verificationId: string;
  let otpError: string | null;
  let deleteStatus: string;
  let failed: boolean;
  let calls: { name: string; body: Record<string, unknown>; auth: string | null }[];
  beforeEach(() => { completed=false; verificationId=userId; otpError=null; deleteStatus="completed"; failed=false; calls=[]; });
  function api() {
    const factory = (accessToken?: string) => createClient("https://synthetic.supabase.co", "synthetic-key", {
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:accessToken?{Authorization:`Bearer ${accessToken}`}:{},fetch:async(input,init)=>{
        const request=new Request(input,init), name=new URL(request.url).pathname.split("/").at(-1)!;
        const raw=request.method==="GET"?"":await request.text();
        const body=raw?JSON.parse(raw):{};
        calls.push({name,body,auth:request.headers.get("authorization")});
        const user={id:userId,email:"student@wisc.edu",email_confirmed_at:"2026-01-01T00:00:00Z",app_metadata:{},user_metadata:{},aud:"authenticated",created_at:"2026-01-01T00:00:00Z"};
        if(name==="user")return Response.json(user);
        if(name==="otp")return otpError?Response.json({code:otpError,msg:"private provider detail"},{status:otpError==="over_email_send_rate_limit"?429:500}):Response.json({});
        if(name==="verify")return otpError?Response.json({code:otpError,msg:"private provider detail"},{status:403}):Response.json({user:{...user,id:verificationId},access_token:token,refresh_token:"synthetic-refresh",token_type:"bearer",expires_in:3600});
        if(name==="logout")return new Response(null,{status:204});
        if(name==="get_account_deletion_receipt")return failed?Response.json({message:"private database detail"},{status:500}):Response.json(completed?"completed":"not_completed");
        if(name==="permanently_delete_member"){if(deleteStatus==="completed")completed=true;return Response.json(deleteStatus);}
        throw new Error("Unexpected synthetic request "+name);
      }},
    });
    return createMobileAuthApi({createClient:factory,getCodec:()=>createEmailOtpContextCodec(secret),getDeletionSecret:()=>secret,createDeletionAdmin:()=>factory("synthetic-admin")});
  }
  function request(path:string,body:unknown={},bearer:string|null=token){return new Request(`https://app.test/api/mobile/v1/account/deletion${path}`,{method:"POST",headers:{"content-type":"application/json",...(bearer?{authorization:`Bearer ${bearer}`}:{cookie:"sb-access-token=fake"})},body:JSON.stringify(body)});}
  async function challenge(handler=api()){const response=await handler(request("/challenge"));expect(response.status).toBe(200);return response.json();}

  it("核验本人并明确确认，提交原子删除；无身份随机回执可在退出后查询及重试",async()=>{
    const handler=api();
    expect((await handler(request("/challenge",{},null))).status).toBe(401);
    const issued=await challenge(handler);
    expect(issued).toMatchObject({status:"code_sent"});
    expect(calls.find(c=>c.name==="otp")?.body).toMatchObject({email:"student@wisc.edu",create_user:false});
    const input={challengeToken:issued.challengeToken,receiptToken:issued.receiptToken,code:"123456",confirmation:"DELETE"};
    const response=await handler(request("",input));
    expect(await response.json()).toEqual({status:"completed"});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    const digest=createHash("sha256").update(issued.receiptToken).digest("hex");
    expect(calls.find(c=>c.name==="permanently_delete_member")?.body).toEqual({target_user:userId,receipt_digest:digest});
    expect(await (await handler(request("/status",{receiptToken:issued.receiptToken},null))).json()).toEqual({status:"completed"});
    expect(await (await handler(request("",input))).json()).toEqual({status:"completed"});
    expect(calls.filter(c=>c.name==="permanently_delete_member")).toHaveLength(1);
  });

  it("伪造目标、遗漏明确确认、查询参数与无效回执在写入前拒绝",async()=>{
    const handler=api(),issued=await challenge(handler);
    const input={challengeToken:issued.challengeToken,receiptToken:issued.receiptToken,code:"123456",confirmation:"DELETE"};
    for(const invalid of [{...input,userId:otherId},{...input,email:"other@wisc.edu"},{...input,confirmation:"yes"},{...input,code:123456},{...input,receiptToken:"guess"}]){
      expect((await handler(request("",invalid))).status).toBe(400);
    }
    expect((await handler(request("/challenge?userId=other"))).status).toBe(400);
    expect((await handler(request("/status",{receiptToken:"guess"},null))).status).toBe(400);
    expect(calls.some(c=>c.name==="verify"||c.name==="permanently_delete_member")).toBe(false);
  });

  it("确认签名、有效期及回执绑定不可替换，验证码核验为另一身份时不删除并撤销临时会话",async()=>{
    const handler=api(),issued=await challenge(handler);
    const input={challengeToken:issued.challengeToken,receiptToken:issued.receiptToken,code:"123456",confirmation:"DELETE"};
    expect((await handler(request("",{...input,challengeToken:`x${issued.challengeToken}`}))).status).toBe(400);
    expect((await handler(request("",{...input,receiptToken:"a".repeat(43)}))).status).toBe(400);
    const clock=vi.spyOn(Date,"now").mockReturnValue((issued.expiresAt+1)*1000);
    try{expect(await (await handler(request("",input))).json()).toEqual({status:"invalid_challenge"});}finally{clock.mockRestore();}
    verificationId=otherId;
    expect(await (await handler(request("",input))).json()).toEqual({status:"identity_mismatch"});
    expect(calls.some(c=>c.name==="permanently_delete_member")).toBe(false);
    expect(calls.some(c=>c.name==="logout")).toBe(true);
  });

  it.each(["owner_transfer_required","storage_cleanup_required"])("%s 明确未完成并清理临时会话，不假报注销成功",async status=>{
    const handler=api(),issued=await challenge(handler);deleteStatus=status;
    const response=await handler(request("",{challengeToken:issued.challengeToken,receiptToken:issued.receiptToken,code:"123456",confirmation:"DELETE"}));
    expect(response.status).toBe(409);expect(await response.json()).toEqual({status});
    expect(completed).toBe(false);expect(calls.some(c=>c.name==="logout")).toBe(true);
  });

  it("限流／验证码失效／暂时故障有明确结果，不回传供应商私密异常",async()=>{
    const handler=api();otpError="over_email_send_rate_limit";
    expect((await handler(request("/challenge"))).status).toBe(429);
    otpError=null;const issued=await challenge(handler);
    otpError="otp_expired";
    const rejected=await handler(request("",{challengeToken:issued.challengeToken,receiptToken:issued.receiptToken,code:"123456",confirmation:"DELETE"}));
    expect(rejected.status).toBe(400);expect(await rejected.json()).toEqual({status:"invalid_or_expired_code"});
    otpError=null;failed=true;
    const unavailable=await handler(request("/status",{receiptToken:issued.receiptToken},null));
    expect(unavailable.status).toBe(503);expect(await unavailable.json()).toEqual({status:"temporarily_unavailable"});
    expect(calls.some(c=>c.name==="permanently_delete_member")).toBe(false);
  });

  it("回执查询独立于失效登录，只返回最小状态；未知删除结果不误报成功",async()=>{
    const handler=api(),issued=await challenge(handler);
    expect(await (await handler(request("/status",{receiptToken:issued.receiptToken},"invalid-expired-token"))).json()).toEqual({status:"not_completed"});
    deleteStatus="unexpected_success";
    const response=await handler(request("",{challengeToken:issued.challengeToken,receiptToken:issued.receiptToken,code:"123456",confirmation:"DELETE"}));
    expect(response.status).toBe(503);expect(await response.json()).toEqual({status:"temporarily_unavailable"});
    expect(calls.some(c=>c.name==="get_member_context")).toBe(false);
  });
});
