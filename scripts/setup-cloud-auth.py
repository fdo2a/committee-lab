"""Register subscription OAuth and validate GitHub access; Mac token storage is manual."""
import argparse,getpass,json,os,subprocess,sys

REPOSITORY='fdo2a/portfolio-investment'

def command(args,secret=None,env=None):
 result=subprocess.run(args,input=secret,text=True,capture_output=True,env=env)
 if result.returncode:raise RuntimeError('Credential operation failed; values withheld')
 return result.stdout

def main(github_only=False):
 if sys.platform!='darwin':raise RuntimeError('Run this authentication handoff on the operator Mac')
 print('이 저장소만 선택한 Actions: read/write GitHub 토큰을 입력하세요.' if github_only else '브라우저는 자동으로 열지 않습니다. claude setup-token으로 발급한 구독 OAuth와 저장소 전용 GitHub 토큰을 입력하세요.')
 oauth='' if github_only else getpass.getpass('Claude 구독 OAuth (숨긴 입력): ').strip()
 dispatch=getpass.getpass('저장소 전용 GitHub 토큰 (숨긴 입력): ').strip()
 if (not github_only and not oauth.startswith('sk-ant-oat')) or not dispatch.startswith('github_pat_'):raise RuntimeError('Use a subscription OAuth and fine-grained GitHub token')
 env={**os.environ,'GH_TOKEN':dispatch}
 info=json.loads(command(['gh','api','repos/'+REPOSITORY],env=env))
 if not info.get('private'):raise RuntimeError('Verifier repository must remain private')
 workflows=json.loads(command(['gh','workflow','list','--repo',REPOSITORY,'--all','--json','path,state'],env=env).strip() or '[]')
 if not github_only:command(['gh','secret','set','CLAUDE_CODE_OAUTH_TOKEN','--repo',REPOSITORY],oauth)
 # The Mac reads .dev.vars, not Worker secrets. Leave local storage to the operator.
 print('GitHub 접근을 확인했습니다. 토큰은 저장하지 않았습니다. docs/cloud-review-setup.md에 따라 ~/committee-runner/.dev.vars (본인 소유 일반 파일, 권한 0600)에 CLOUD_REVIEW_DISPATCH_TOKEN을 수동 입력하세요. CLOUD_REVIEW_ENABLED=false를 유지하고 나머지 필수 변수도 확인하세요.')
 ready=any(w.get('path')=='.github/workflows/claude-review.yml' and w.get('state')=='active' for w in workflows)
 if github_only:return
 if not ready:print('Claude 구독 secret은 등록됐습니다. 검토기 워크플로가 아직 활성화되지 않아 인증검사는 대기합니다.');return
 print('Claude 구독 secret은 등록됐습니다. 등록 자체는 Claude 심사를 실행하지 않습니다. Mac 설정 후 claude-review.yml을 job_id=auth-check로 한 번 실행해 읽기 전용 증명을 확인한 뒤에만 CLOUD_REVIEW_ENABLED를 켭니다.')

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--github-only',action='store_true',help='Validate only GitHub access; save the dispatch token to the Mac manually')
 args=parser.parse_args()
 try:main(args.github_only)
 except Exception:print('인증 설정이 완료되지 않았습니다. 비밀값은 출력하지 않았습니다.',file=sys.stderr);sys.exit(1)
