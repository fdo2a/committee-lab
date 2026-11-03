import importlib.util,pathlib,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('cloud_auth',pathlib.Path(__file__).resolve().parents[1]/'scripts'/'setup-cloud-auth.py')
auth=importlib.util.module_from_spec(spec);spec.loader.exec_module(auth)

class CloudAuthTest(unittest.TestCase):
 def test_github_only_uses_one_hidden_prompt_and_requires_manual_mac_token_storage(self):
  calls=[]
  def command(args,secret=None,env=None):
   calls.append((args,secret,env));self.assertNotIn('github_pat_fixture',' '.join(args))
   if args[:2]==['gh','api']:return '{"private":true}'
   if args[:3]==['gh','workflow','list']:return '[]'
   return ''
  with patch.object(auth.sys,'platform','darwin'),patch.object(auth.getpass,'getpass',return_value='github_pat_fixture') as prompt,patch.object(auth,'command',side_effect=command),patch('builtins.print') as output:
   auth.main(github_only=True)
  prompt.assert_called_once();self.assertIn('GitHub',prompt.call_args[0][0])
  self.assertEqual(calls[1][0][:3],['gh','workflow','list']);self.assertEqual(calls[1][2]['GH_TOKEN'],'github_pat_fixture')
  self.assertEqual([args for args,_,_ in calls if args[:2]==['gh','secret'] or args[:3]==['gh','workflow','run']],[])
  self.assertEqual(len(calls),2)
  self.assertIn('~/committee-runner/.dev.vars',output.call_args[0][0]);self.assertIn('0600',output.call_args[0][0]);self.assertIn('수동',output.call_args[0][0])
  self.assertNotIn('github_pat_fixture',str(output.call_args_list))
 def test_github_only_rejects_broad_token_before_storage(self):
  with patch.object(auth.sys,'platform','darwin'),patch.object(auth.getpass,'getpass',return_value='gho_broad'),patch.object(auth,'command',side_effect=AssertionError('Must not register')),patch('builtins.print'):
   with self.assertRaises(RuntimeError):auth.main(github_only=True)
 def test_oauth_uses_stdin_and_dispatch_token_requires_manual_mac_storage_without_review(self):
  calls=[]
  def command(args,secret=None,env=None):
   calls.append((args,secret,env))
   self.assertNotIn('github_pat_fixture',' '.join(args));self.assertNotIn('sk-ant-oat-fixture',' '.join(args))
   if args[:2]==['gh','api']:return '{"private":true}'
   if args[:3]==['gh','workflow','list']:return '[{"path":".github/workflows/claude-review.yml","state":"active"}]'
   return ''
  with patch.object(auth.sys,'platform','darwin'),patch.object(auth.getpass,'getpass',side_effect=['sk-ant-oat-fixture','github_pat_fixture']),patch.object(auth,'command',side_effect=command),patch('builtins.print') as output:
   auth.main()
  oauth=[c for c in calls if c[0][:3]==['gh','secret','set']];self.assertEqual(len(oauth),1);self.assertEqual(oauth[0][1],'sk-ant-oat-fixture');self.assertIsNone(oauth[0][2])
  self.assertEqual(len(calls),3);self.assertEqual(calls[-1][0][:3],['gh','secret','set'])
  self.assertIn('~/committee-runner/.dev.vars',str(output.call_args_list));self.assertIn('0600',str(output.call_args_list));self.assertIn('수동',str(output.call_args_list))
  self.assertNotIn('github_pat_fixture',str(output.call_args_list));self.assertNotIn('sk-ant-oat-fixture',str(output.call_args_list))
  self.assertFalse(any(args[:3]==['gh','workflow','run'] for args,_,_ in calls))
  self.assertIn('auth-check',output.call_args[0][0])
 def test_registration_before_approved_workflow_does_not_dispatch_or_claim_authentication(self):
  calls=[]
  def command(args,secret=None,env=None):
   calls.append(args)
   if args[:2]==['gh','api']:return '{"private":true}'
   if args[:3]==['gh','workflow','list']:return '[]'
   return ''
  with patch.object(auth.sys,'platform','darwin'),patch.object(auth.getpass,'getpass',side_effect=['sk-ant-oat-fixture','github_pat_fixture']),patch.object(auth,'command',side_effect=command),patch('builtins.print') as output:
   auth.main()
  self.assertFalse(any(args[:3]==['gh','workflow','run'] for args in calls))
  self.assertEqual(len(calls),3)
  self.assertIn('~/committee-runner/.dev.vars',str(output.call_args_list))
  self.assertIn('인증검사는 대기',output.call_args[0][0])
 def test_paid_api_or_broad_cli_token_is_rejected_before_registration(self):
  with patch.object(auth.sys,'platform','darwin'),patch.object(auth.getpass,'getpass',side_effect=['sk-ant-api-fixture','gho_broad']),patch.object(auth,'command',side_effect=AssertionError('Must not register')),patch('builtins.print'):
   with self.assertRaises(RuntimeError):auth.main()
 def test_public_repository_is_refused(self):
  def command(args,secret=None,env=None):
   if args[:2]==['gh','api']:return '{"private":false}'
   raise AssertionError('Must not continue')
  with patch.object(auth.sys,'platform','darwin'),patch.object(auth.getpass,'getpass',return_value='github_pat_fixture'),patch.object(auth,'command',side_effect=command),patch('builtins.print'):
   with self.assertRaises(RuntimeError):auth.main(github_only=True)

if __name__=='__main__':unittest.main()
