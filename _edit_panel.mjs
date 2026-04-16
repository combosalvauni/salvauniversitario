import { readFileSync, writeFileSync } from 'node:fs';

const f = 'z:\\appsalva\\src\\components\\admin\\WhatsAppPanel.jsx';
let c = readFileSync(f, 'utf8');

// 1. Insert handleUploadAudio callback before handleStartEdit
const startEditIdx = c.indexOf('const handleStartEdit');
if (startEditIdx === -1) { console.log('ERROR: handleStartEdit not found'); process.exit(1); }

const closingBracketIdx = c.lastIndexOf('  }, []);', startEditIdx);
if (closingBracketIdx === -1) { console.log('ERROR: closing bracket not found'); process.exit(1); }

const beforePart = c.substring(0, closingBracketIdx);
const afterPart = c.substring(startEditIdx);

const uploadHandler = `  }, []);

  const handleUploadAudio = useCallback(async (planKey, file) => {
    setUploading(true);
    try {
      const result = await uploadWhatsAppAudio(file, planKey);
      if (result?.audioUrl) {
        setConfig((prev) => ({
          ...prev,
          plans: {
            ...prev.plans,
            [planKey]: { ...prev.plans[planKey], audioUrl: result.audioUrl },
          },
        }));
        setSaveMsg('\u00c1udio enviado e convertido com sucesso!');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      setError(err?.message || 'Erro ao enviar \u00e1udio.');
    } finally {
      setUploading(false);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  }, []);

  `;

c = beforePart + uploadHandler + afterPart;

// 2. Replace audio URL section with upload + URL input
const oldAudioLabel = '                      <label className="text-xs text-gray-400">URL do \u00c1udio (MP3, OGG, etc.)</label>';
const oldAudioLabelIdx = c.indexOf('URL do');
if (oldAudioLabelIdx === -1) { console.log('ERROR: audio label not found'); process.exit(1); }

// Find the start of the <div className="space-y-2"> that contains the audio URL section
const spaceY2Before = c.lastIndexOf('<div className="space-y-2">', oldAudioLabelIdx);
// Find the closing </div> for it — it's the one after "usa o áudio global" text
const globalEnvText = c.indexOf('usa o', oldAudioLabelIdx);
// Find the </div> that closes the space-y-2
let closingDiv = c.indexOf('</div>', globalEnvText);
closingDiv = c.indexOf('\n', closingDiv) + 1; // include the newline

const oldSection = c.substring(spaceY2Before, closingDiv);
console.log('Old section preview:', oldSection.substring(0, 100));

const newSection = `<div className="space-y-2">
                      <label className="text-xs text-gray-400">Enviar \u00c1udio (converte automaticamente para OGG Opus)</label>
                      <div className="flex gap-2 items-center">
                        <input
                          ref={audioInputRef}
                          type="file"
                          accept="audio/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadAudio(selectedPlan, file);
                          }}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => audioInputRef.current?.click()}
                          disabled={uploading}
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                          {uploading
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Convertendo...</>
                            : <><Upload className="h-4 w-4 mr-1" /> Enviar \u00c1udio</>
                          }
                        </Button>
                      </div>
                      {plan.audioUrl && (
                        <div className="space-y-1">
                          <p className="text-xs text-green-400 flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> \u00c1udio configurado
                          </p>
                          <p className="text-[10px] text-gray-500 truncate" title={plan.audioUrl}>
                            {plan.audioUrl}
                          </p>
                        </div>
                      )}
                      {!plan.audioUrl && (
                        <p className="text-xs text-gray-500">
                          Sem \u00e1udio neste plano. Envie um arquivo acima ou cole uma URL abaixo.
                        </p>
                      )}
                      <div className="flex gap-2 mt-1">
                        <Input
                          placeholder="Ou cole a URL diretamente..."
                          value={plan.audioUrl || ''}
                          onChange={(e) => {
                            setConfig((prev) => ({
                              ...prev,
                              plans: {
                                ...prev.plans,
                                [selectedPlan]: { ...prev.plans[selectedPlan], audioUrl: e.target.value },
                              },
                            }));
                          }}
                          className="flex-1 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveAudioUrl(selectedPlan, plan.audioUrl || '')}
                          disabled={saving}
                          className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
`;

c = c.substring(0, spaceY2Before) + newSection + c.substring(closingDiv);

writeFileSync(f, c, 'utf8');
console.log('Lines:', c.split('\n').length);
console.log('Has handleUploadAudio:', c.includes('handleUploadAudio'));
console.log('Has Upload button:', c.includes('Enviar \u00c1udio'));
console.log('Has hidden file input:', c.includes('type="file"'));
