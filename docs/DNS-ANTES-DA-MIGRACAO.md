# Zona DNS de corquimica.com.br antes da migração (14/10/2026)

Cópia do Editor de Zona do cPanel (Webstorage, servidor bells.webstorage.com.br), feita antes de qualquer alteração.
Nameservers: ns10/ns11.webstorage.com.br e ns10/ns11.webstorage.net.br. TTL de todos os registros: 14400.

| Nome | Tipo | Valor |
|---|---|---|
| corquimica.com.br. | A | 138.186.228.40 |
| corquimica.com.br. | MX | 0 corquimica.com.br |
| corquimica.com.br. | MX | 10 ns1.webstorage.com.br |
| corquimica.com.br. | TXT | v=spf1 +a +mx ip4:138.186.228.0/24 +include:spf.antispamcloud.com -all |
| mail.corquimica.com.br. | CNAME | corquimica.com.br |
| www.corquimica.com.br. | CNAME | corquimica.com.br |
| ftp, webmail, webdisk, cpcontacts, cpanel, cpcalendars, whm, autoconfig, autodiscover | A | 138.186.228.40 |
| default._domainkey.corquimica.com.br. | TXT | DKIM (v=DKIM1; k=rsa; p=MIIBIjANBgkq… chave completa no cPanel) |
| _cpanel-dcv-test-record | TXT | (verificação de certificado do cPanel) |
| _acme-challenge | TXT | (verificação de certificado) |
| em1703.contato / s1._domainkey.contato / s2._domainkey.contato | CNAME | SendGrid (u11410150.wl151.sendgrid.net) |
| contato.corquimica.com.br. | MX | 10 mx.sendgrid.net |
| contato.corquimica.com.br. | TXT | v=spf1 include:sendgrid.net ~all |
| _dmarc.contato | TXT | v=DMARC1;p=none |
| _autodiscover._tcp | SRV | 0 0 443 cpanelemaildiscovery.cpanel.net |
| _carddavs._tcp / _caldavs._tcp | SRV | 0 0 2080 corquimica.com.br |
| _carddav._tcp / _caldav._tcp | SRV | 0 0 2079 corquimica.com.br |
| _carddav(s)/_caldav(s)._tcp | TXT | path=/ |

## Para desfazer a Fase 1
- mail.corquimica.com.br: voltar de A 138.186.228.40 para CNAME corquimica.com.br
- MX prioridade 0: voltar o destino de mail.corquimica.com.br para corquimica.com.br

## Fase 2 (14/10/2026): site apontado para o GitHub Pages

Alterado no Editor de Zona:
- `corquimica.com.br` A: `138.186.228.40` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (3 registros novos)
- `www` CNAME: `corquimica.com.br` → `axelmusso.github.io`
- `_caldav._tcp`, `_caldavs._tcp`, `_carddav._tcp`, `_carddavs._tcp` SRV: destino `corquimica.com.br` → `mail.corquimica.com.br`

Para desfazer (voltar ao site antigo da Webstorage): apagar 3 dos 4 registros A `185.199.x.153`, editar o restante para `138.186.228.40` e voltar o `www` para CNAME `corquimica.com.br`. Os SRV podem ficar como estão.

## Fase 3 (15/10/2026): subdomínio de disparo `comercial.corquimica.com.br` (Resend)

Criado no Editor de Zona (nada existente foi alterado; o domínio principal, o MX da empresa e o `contato.` do SendGrid ficaram iguais):

| Nome | Tipo | Valor | Para quê |
|---|---|---|---|
| `resend._domainkey.comercial` | TXT | `p=MIGfMA0G…8wIDAQAB` (chave DKIM do Resend, completa no painel do Resend) | Assinatura dos e-mails |
| `send.comercial` | CNAME | `send.forge.rmta.net` | Envio (SPF e bounces) |
| `rsend.comercial` | CNAME | `rsend-sae1.forge.rmta.net` | Envio, região São Paulo |
| `comercial` | MX 10 | `inbound-smtp.sa-east-1.amazonaws.com` | Recebe as respostas no Resend |
| `_dmarc.comercial` | TXT | `v=DMARC1; p=none;` | Política anti-falsificação só do subdomínio (monitoramento) |

O Resend sugeriu o DMARC em `_dmarc` (domínio principal). Foi colocado em `_dmarc.comercial` de propósito, para não mexer na política do e-mail principal.

Para desfazer: apagar os 5 registros acima. Não afeta site nem e-mail principal.
