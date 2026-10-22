import { currentHost } from './host.mjs';
export const HOST_POLICY = "Coming Jobs业务数据仅使用jobos_next的jobos1_接口；允许当前宿主检索、浏览器、Computer Use及插件维护工具。普通已确认资料直接复用，不逐项重复提问；材料用户审核后上传更新。最终提交需用户逐批明确批准，仅在带批次码的审批单授权范围内执行；变化项暂停，外部结果不明不重试。验证码不落库，扫码、图形验证、滑块、密码、注册、承诺书和法律声明由用户本人处理。岗位发现先读取官网全部分页与完整JD，读取失败才考虑Computer Use，按推荐度从高到低排序后编号；缺口如实说明。授权不扩大；本地保存、门户保存、实际提交分别核验。";
export const HOST_ADDENDA = Object.freeze({"codex": "Codex：登录先复用已获准会话；初始化一次申请邮箱/短信只读权限，获准后邮箱优先读取并填写本次验证码，短信其次；读取不到才交接。验证码只在当前流程内临时使用；继续遵守宿主当次权限和协议规则。", "claude": "Claude：验证码由用户输入；不读取邮箱或短信验证码，不请求这些读取权限。javascript_tool 只用于只读回读，不写表单、不注入文件。使用内置浏览器；上传文件集中由用户拖入。"});
export const hostPolicy = () => HOST_POLICY + '\n' + HOST_ADDENDA[currentHost().id];
